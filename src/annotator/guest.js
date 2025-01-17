import { Bridge } from '../shared/bridge';
import { ListenerCollection } from '../shared/listener-collection';

import { Adder } from './adder';
import { AnnotationSync } from './annotation-sync';
import { TextRange } from './anchoring/text-range';
import {
  getHighlightsContainingNode,
  highlightRange,
  removeAllHighlights,
  removeHighlights,
  setHighlightsFocused,
  setHighlightsVisible,
} from './highlighter';
import { HypothesisInjector } from './hypothesis-injector';
import { createIntegration } from './integrations';
import * as rangeUtil from './range-util';
import { SelectionObserver } from './selection-observer';
import { normalizeURI } from './util/url';

/**
 * @typedef {import('../types/annotator').AnnotationData} AnnotationData
 * @typedef {import('../types/annotator').Annotator} Annotator
 * @typedef {import('../types/annotator').Anchor} Anchor
 * @typedef {import('../types/annotator').Destroyable} Destroyable
 * @typedef {import('../types/annotator').SidebarLayout} SidebarLayout
 * @typedef {import('../types/api').Target} Target
 * @typedef {import('../types/bridge-events').GuestToSidebarEvent} GuestToSidebarEvent
 * @typedef {import('../types/bridge-events').SidebarToGuestEvent} SidebarToGuestEvent
 * @typedef {import('./util/emitter').EventBus} EventBus
 */

/**
 * HTML element created by the highlighter with an associated annotation.
 *
 * @typedef {HTMLElement & { _annotation?: AnnotationData }} AnnotationHighlight
 */

/**
 * Return all the annotations associated with the selected text.
 *
 * @return {AnnotationData[]}
 */
function annotationsForSelection() {
  const selection = /** @type {Selection} */ (window.getSelection());
  const range = selection.getRangeAt(0);
  const items = rangeUtil.itemsForRange(
    range,

    // nb. Only non-nullish items are returned by `itemsForRange`.
    node => /** @type {AnnotationHighlight} */ (node)._annotation
  );
  return /** @type {AnnotationData[]} */ (items);
}

/**
 * Return the annotations associated with any highlights that contain a given
 * DOM node.
 *
 * @param {Node} node
 * @return {AnnotationData[]}
 */
function annotationsAt(node) {
  const items = getHighlightsContainingNode(node)
    .map(h => /** @type {AnnotationHighlight} */ (h)._annotation)
    .filter(ann => ann !== undefined);
  return /** @type {AnnotationData[]} */ (items);
}

/**
 * Resolve an anchor's associated document region to a concrete `Range`.
 *
 * This may fail if anchoring failed or if the document has been mutated since
 * the anchor was created in a way that invalidates the anchor.
 *
 * @param {Anchor} anchor
 * @return {Range|null}
 */
function resolveAnchor(anchor) {
  if (!anchor.range) {
    return null;
  }
  try {
    return anchor.range.toRange();
  } catch {
    return null;
  }
}

/**
 * `Guest` is the central class of the annotator that handles anchoring (locating)
 * annotations in the document when they are fetched by the sidebar, rendering
 * highlights for them and handling subsequent interactions with the highlights.
 *
 * It is also responsible for listening to changes in the current selection
 * and triggering the display of controls to create new annotations. When one
 * of these controls is clicked, it creates the new annotation and sends it to
 * the sidebar.
 *
 * Within a browser tab, there is typically one `Guest` instance per frame that
 * loads Hypothesis (not all frames will be annotation-enabled). In one frame,
 * usually the top-level one, there will also be an instance of the `Sidebar`
 * class that shows the sidebar app and surrounding UI. The `Guest` instance in
 * each frame connects to the sidebar when {@link connectToSidebar} is called.
 *
 * The anchoring implementation defaults to a generic one for HTML documents and
 * can be overridden to handle different document types.
 *
 * @implements {Annotator}
 * @implements {Destroyable}
 */
export default class Guest {
  /**
   * @param {HTMLElement} element -
   *   The root element in which the `Guest` instance should be able to anchor
   *   or create annotations. In an ordinary web page this typically `document.body`.
   * @param {EventBus} eventBus -
   *   Enables communication between components sharing the same eventBus
   * @param {Record<string, any>} [config]
   * @param {Window} [hostFrame] -
   *   Host frame which this guest is associated with. This is expected to be
   *   an ancestor of the guest frame. It may be same or cross origin.
   */
  constructor(element, eventBus, config = {}, hostFrame = window) {
    this.element = element;
    this._emitter = eventBus.createEmitter();
    this._highlightsVisible = false;
    this._isAdderVisible = false;

    this._adder = new Adder(this.element, {
      onAnnotate: async () => {
        await this.createAnnotation();
        /** @type {Selection} */ (document.getSelection()).removeAllRanges();
      },
      onHighlight: async () => {
        await this.createAnnotation({ highlight: true });
        /** @type {Selection} */ (document.getSelection()).removeAllRanges();
      },
      onShowAnnotations: anns => {
        this.selectAnnotations(anns);
      },
    });

    this._selectionObserver = new SelectionObserver(range => {
      if (range) {
        this._onSelection(range);
      } else {
        this._onClearSelection();
      }
    });

    /**
     * The anchors generated by resolving annotation selectors to locations in the
     * document. These are added by `anchor` and removed by `detach`.
     *
     * There is one anchor per annotation `Target`, which typically means one
     * anchor per annotation.
     *
     * @type {Anchor[]}
     */
    this.anchors = [];

    // Set the frame identifier if it's available.
    // The "top" guest instance will have this as null since it's in a top frame not a sub frame
    this._frameIdentifier = config.subFrameIdentifier || null;

    /**
     * Channel for sidebar-guest communication.
     *
     * @type {Bridge<GuestToSidebarEvent,SidebarToGuestEvent>}
     */
    this._bridge = new Bridge();
    this._connectSidebarEvents();

    // Set up listeners for when the sidebar asks us to add or remove annotations
    // in this frame.
    this._annotationSync = new AnnotationSync(eventBus, this._bridge);
    this._connectAnnotationSync();

    // Set up automatic and integration-triggered injection of client into
    // iframes in this frame.
    this._hypothesisInjector = new HypothesisInjector(this.element, config);

    /**
     * Integration that handles document-type specific functionality in the
     * guest.
     */
    this._integration = createIntegration(this);

    this._sideBySideActive = false;

    // Setup event handlers on the root element
    this._listeners = new ListenerCollection();
    this._setupElementEvents();

    /**
     * Tags of currently focused annotations. This is used to set the focused
     * state correctly for new highlights if the associated annotation is already
     * focused in the sidebar.
     *
     * @type {Set<string>}
     */
    this._focusedAnnotations = new Set();

    this._hostFrame = hostFrame;
    this._listeners.add(window, 'unload', () => this._notifyGuestUnload());
  }

  // Add DOM event listeners for clicks, taps etc. on the document and
  // highlights.
  _setupElementEvents() {
    // Hide the sidebar in response to a document click or tap, so it doesn't obscure
    // the document content.
    /** @param {Element} element */
    const maybeCloseSidebar = element => {
      if (this._sideBySideActive) {
        // Don't hide the sidebar if event was disabled because the sidebar
        // doesn't overlap the content.
        return;
      }
      if (annotationsAt(element).length) {
        // Don't hide the sidebar if the event comes from an element that contains a highlight
        return;
      }
      this._bridge.call('closeSidebar');
    };

    this._listeners.add(this.element, 'mouseup', event => {
      const { target, metaKey, ctrlKey } = /** @type {MouseEvent} */ (event);
      const annotations = annotationsAt(/** @type {Element} */ (target));
      if (annotations.length && this._highlightsVisible) {
        const toggle = metaKey || ctrlKey;
        this.selectAnnotations(annotations, toggle);
      }
    });

    this._listeners.add(this.element, 'mousedown', ({ target }) => {
      maybeCloseSidebar(/** @type {Element} */ (target));
    });

    // Allow taps on the document to hide the sidebar as well as clicks.
    // On iOS < 13 (2019), elements like h2 or div don't emit 'click' events.
    this._listeners.add(this.element, 'touchstart', ({ target }) => {
      maybeCloseSidebar(/** @type {Element} */ (target));
    });

    this._listeners.add(this.element, 'mouseover', ({ target }) => {
      const annotations = annotationsAt(/** @type {Element} */ (target));
      if (annotations.length && this._highlightsVisible) {
        this._focusAnnotations(annotations);
      }
    });

    this._listeners.add(this.element, 'mouseout', () => {
      if (this._highlightsVisible) {
        this._focusAnnotations([]);
      }
    });

    this._listeners.add(window, 'resize', () => this._repositionAdder());
  }

  /**
   * Inject the Hypothesis client into a guest frame.
   *
   * @param {HTMLIFrameElement} frame
   */
  async injectClient(frame) {
    return this._hypothesisInjector.injectClient(frame);
  }

  /**
   * Retrieve metadata for the current document.
   */
  async getDocumentInfo() {
    const [uri, metadata] = await Promise.all([
      this._integration.uri(),
      this._integration.getMetadata(),
    ]);

    return {
      uri: normalizeURI(uri),
      metadata,
      frameIdentifier: this._frameIdentifier,
    };
  }

  /**
   * Shift the position of the adder on window 'resize' events
   */
  _repositionAdder() {
    if (this._isAdderVisible === false) {
      return;
    }
    const range = window.getSelection()?.getRangeAt(0);
    if (range) {
      this._onSelection(range);
    }
  }

  _connectAnnotationSync() {
    this._emitter.subscribe('annotationDeleted', annotation => {
      this.detach(annotation);
    });

    this._emitter.subscribe('annotationsLoaded', annotations => {
      annotations.map(annotation => this.anchor(annotation));
    });
  }

  _connectSidebarEvents() {
    // Handlers for events sent when user hovers or clicks on an annotation card
    // in the sidebar.
    this._bridge.on('focusAnnotations', (tags = []) => {
      this._focusedAnnotations.clear();
      tags.forEach(tag => this._focusedAnnotations.add(tag));

      for (let anchor of this.anchors) {
        if (anchor.highlights) {
          const toggle = tags.includes(anchor.annotation.$tag);
          setHighlightsFocused(anchor.highlights, toggle);
        }
      }
    });

    this._bridge.on('scrollToAnnotation', tag => {
      const anchor = this.anchors.find(a => a.annotation.$tag === tag);
      if (!anchor?.highlights) {
        return;
      }
      const range = resolveAnchor(anchor);
      if (!range) {
        return;
      }

      // Emit a custom event that the host page can respond to. This is useful,
      // for example, if the highlighted content is contained in a collapsible
      // section of the page that needs to be un-collapsed.
      const event = new CustomEvent('scrolltorange', {
        bubbles: true,
        cancelable: true,
        detail: range,
      });
      const defaultNotPrevented = this.element.dispatchEvent(event);

      if (defaultNotPrevented) {
        this._integration.scrollToAnchor(anchor);
      }
    });

    // Handler for when sidebar requests metadata for the current document
    this._bridge.on('getDocumentInfo', cb => {
      this.getDocumentInfo()
        .then(info => cb(null, info))
        .catch(reason => cb(reason));
    });

    // Handler for controls on the sidebar
    this._bridge.on('setHighlightsVisible', showHighlights => {
      this.setHighlightsVisible(showHighlights);
    });
  }

  destroy() {
    this._notifyGuestUnload();
    this._hypothesisInjector.destroy();
    this._listeners.removeAll();

    this._selectionObserver.disconnect();
    this._adder.destroy();

    removeAllHighlights(this.element);

    this._integration.destroy();
    this._emitter.destroy();
    this._annotationSync.destroy();
    this._bridge.destroy();
  }

  /**
   * Notify the host frame that the guest is being unloaded.
   *
   * The host frame in turn notifies the sidebar app that the guest has gone away.
   */
  _notifyGuestUnload() {
    const message = {
      type: 'hypothesisGuestUnloaded',
      frameIdentifier: this._frameIdentifier,
    };
    this._hostFrame.postMessage(message, '*');
  }

  /**
   * Attempt to connect to the sidebar frame.
   *
   * @param {Window} frame - The window containing the sidebar application
   * @param {string} origin - Origin of the sidebar application (eg. 'https://hypothes.is/')
   */
  connectToSidebar(frame, origin) {
    const channel = new MessageChannel();
    frame.postMessage(
      {
        type: 'hypothesisGuestReady',
      },
      origin,
      [channel.port2]
    );
    this._bridge.createChannel(channel.port1);
  }

  /**
   * Anchor an annotation's selectors in the document.
   *
   * _Anchoring_ resolves a set of selectors to a concrete region of the document
   * which is then highlighted.
   *
   * Any existing anchors associated with `annotation` will be removed before
   * re-anchoring the annotation.
   *
   * @param {AnnotationData} annotation
   * @return {Promise<Anchor[]>}
   */
  async anchor(annotation) {
    /**
     * Resolve an annotation's selectors to a concrete range.
     *
     * @param {Target} target
     * @return {Promise<Anchor>}
     */
    const locate = async target => {
      // Only annotations with an associated quote can currently be anchored.
      // This is because the quote is used to verify anchoring with other selector
      // types.
      if (
        !target.selector ||
        !target.selector.some(s => s.type === 'TextQuoteSelector')
      ) {
        return { annotation, target };
      }

      /** @type {Anchor} */
      let anchor;
      try {
        const range = await this._integration.anchor(
          this.element,
          target.selector
        );
        // Convert the `Range` to a `TextRange` which can be converted back to
        // a `Range` later. The `TextRange` representation allows for highlights
        // to be inserted during anchoring other annotations without "breaking"
        // this anchor.
        const textRange = TextRange.fromRange(range);
        anchor = { annotation, target, range: textRange };
      } catch (err) {
        anchor = { annotation, target };
      }
      return anchor;
    };

    /**
     * Highlight the text range that `anchor` refers to.
     *
     * @param {Anchor} anchor
     */
    const highlight = anchor => {
      const range = resolveAnchor(anchor);
      if (!range) {
        return;
      }

      const highlights = /** @type {AnnotationHighlight[]} */ (
        highlightRange(range)
      );
      highlights.forEach(h => {
        h._annotation = anchor.annotation;
      });
      anchor.highlights = highlights;

      if (this._focusedAnnotations.has(anchor.annotation.$tag)) {
        setHighlightsFocused(highlights, true);
      }
    };

    // Remove existing anchors for this annotation.
    this.detach(annotation, false /* notify */);

    // Resolve selectors to ranges and insert highlights.
    if (!annotation.target) {
      annotation.target = [];
    }
    const anchors = await Promise.all(annotation.target.map(locate));
    for (let anchor of anchors) {
      highlight(anchor);
    }

    // Set flag indicating whether anchoring succeeded. For each target,
    // anchoring is successful either if there are no selectors (ie. this is a
    // Page Note) or we successfully resolved the selectors to a range.
    annotation.$orphan =
      anchors.length > 0 &&
      anchors.every(anchor => anchor.target.selector && !anchor.range);

    this._updateAnchors(this.anchors.concat(anchors), true /* notify */);

    // Let other frames (eg. the sidebar) know about the new annotation.
    this._annotationSync.sync([annotation]);

    return anchors;
  }

  /**
   * Remove the anchors and associated highlights for an annotation from the document.
   *
   * @param {AnnotationData} annotation
   * @param {boolean} [notify] - For internal use. Whether to emit an `anchorsChanged` notification
   */
  detach(annotation, notify = true) {
    const anchors = [];
    for (let anchor of this.anchors) {
      if (anchor.annotation !== annotation) {
        anchors.push(anchor);
      } else if (anchor.highlights) {
        removeHighlights(anchor.highlights);
      }
    }
    this._updateAnchors(anchors, notify);
  }

  /**
   * @param {Anchor[]} anchors
   * @param {boolean} notify
   */
  _updateAnchors(anchors, notify) {
    this.anchors = anchors;
    if (notify) {
      this._emitter.publish('anchorsChanged', this.anchors);
    }
  }

  /**
   * Create a new annotation that is associated with the selected region of
   * the current document.
   *
   * @param {object} options
   *   @param {boolean} [options.highlight] - If true, the new annotation has
   *     the `$highlight` flag set, causing it to be saved immediately without
   *     prompting for a comment.
   * @return {Promise<AnnotationData>} - The new annotation
   */
  async createAnnotation({ highlight = false } = {}) {
    const ranges = this.selectedRanges ?? [];
    this.selectedRanges = null;

    const info = await this.getDocumentInfo();
    const root = this.element;
    const rangeSelectors = await Promise.all(
      ranges.map(range => this._integration.describe(root, range))
    );
    const target = rangeSelectors.map(selectors => ({
      source: info.uri,

      // In the Hypothesis API the field containing the selectors is called
      // `selector`, despite being a list.
      selector: selectors,
    }));

    /** @type {AnnotationData} */
    const annotation = {
      uri: info.uri,
      document: info.metadata,
      target,
      $highlight: highlight,

      // nb. `$tag` is assigned by `AnnotationSync`.
      $tag: '',
    };

    this._emitter.publish('beforeAnnotationCreated', annotation);
    this.anchor(annotation);

    return annotation;
  }

  /**
   * Indicate in the sidebar that certain annotations are focused (ie. the
   * associated document region(s) is hovered).
   *
   * @param {AnnotationData[]} annotations
   */
  _focusAnnotations(annotations) {
    const tags = annotations.map(a => a.$tag);
    this._bridge.call('focusAnnotations', tags);
  }

  /**
   * Show or hide the adder toolbar when the selection changes.
   *
   * @param {Range} range
   */
  _onSelection(range) {
    if (!this._integration.canAnnotate(range)) {
      this._onClearSelection();
      return;
    }

    const selection = /** @type {Selection} */ (document.getSelection());
    const isBackwards = rangeUtil.isSelectionBackwards(selection);
    const focusRect = rangeUtil.selectionFocusRect(selection);
    if (!focusRect) {
      // The selected range does not contain any text
      this._onClearSelection();
      return;
    }

    this.selectedRanges = [range];
    this._emitter.publish('hasSelectionChanged', true);

    this._adder.annotationsForSelection = annotationsForSelection();
    this._isAdderVisible = true;
    this._adder.show(focusRect, isBackwards);
  }

  _onClearSelection() {
    this._isAdderVisible = false;
    this._adder.hide();
    this.selectedRanges = [];
    this._emitter.publish('hasSelectionChanged', false);
  }

  /**
   * Show the given annotations in the sidebar.
   *
   * This sets up a filter in the sidebar to show only the selected annotations
   * and opens the sidebar.
   *
   * @param {AnnotationData[]} annotations
   * @param {boolean} [toggle] - Toggle whether the annotations are selected
   *   instead of showing them regardless of whether they are currently selected.
   */
  selectAnnotations(annotations, toggle = false) {
    const tags = annotations.map(a => a.$tag);
    if (toggle) {
      this._bridge.call('toggleAnnotationSelection', tags);
    } else {
      this._bridge.call('showAnnotations', tags);
    }
    this._bridge.call('openSidebar');
  }

  /**
   * Scroll the document content so that `anchor` is visible.
   *
   * @param {Anchor} anchor
   */
  scrollToAnchor(anchor) {
    return this._integration.scrollToAnchor(anchor);
  }

  /**
   * Set whether highlights are visible in the document or not.
   *
   * @param {boolean} visible
   */
  setHighlightsVisible(visible) {
    setHighlightsVisible(this.element, visible);
    this._highlightsVisible = visible;
  }

  /**
   * Return the scrollable element that contains the main document content.
   *
   * @return {HTMLElement}
   */
  contentContainer() {
    return this._integration.contentContainer();
  }

  /**
   * Attempt to fit the document content alongside the sidebar.
   *
   * @param {SidebarLayout} sidebarLayout
   */
  fitSideBySide(sidebarLayout) {
    this._sideBySideActive = this._integration.fitSideBySide(sidebarLayout);
  }

  /**
   * Return true if side-by-side mode is currently active.
   *
   * Side-by-side mode is activated or de-activated when `fitSideBySide` is called
   * depending on whether the sidebar is expanded and whether there is room for
   * the content alongside the sidebar.
   */
  get sideBySideActive() {
    return this._sideBySideActive;
  }

  /**
   * Return the tags of annotations that are currently displayed in a focused
   * state.
   *
   * @return {Set<string>}
   */
  get focusedAnnotationTags() {
    return this._focusedAnnotations;
  }
}
