import { ListenerCollection } from '../../shared/listener-collection';
import { HTMLIntegration } from './html';

/**
 * @typedef {import('../../types/annotator').Anchor} Anchor
 * @typedef {import('../../types/annotator').Annotator} Annotator
 * @typedef {import('../../types/annotator').Integration} Integration
 * @typedef {import('../../types/annotator').Selector} Selector
 */

/**
 * Return the custom DOM element that contains the book content iframe.
 */
function findBookElement(document_ = document) {
  return document_.querySelector('mosaic-book');
}

/**
 * Return the role of the current frame in the VitalSource Bookshelf reader or
 * `null` if the frame is not part of Bookshelf.
 *
 * @return {'container'|'content'|null} - `container` if this is the parent of
 *   the content frame, `content` if this is the frame that contains the book
 *   content or `null` if the document is not part of the Bookshelf reader.
 */
export function vitalSourceFrameRole(window_ = window) {
  if (findBookElement(window_.document)) {
    return 'container';
  }

  const parentDoc = window_.frameElement?.ownerDocument;
  if (parentDoc && findBookElement(parentDoc)) {
    return 'content';
  }

  return null;
}

/**
 * Integration for the container frame in VitalSource's Bookshelf ebook reader.
 *
 * This frame cannot be annotated directly. This integration serves only to
 * load the client into the frame that contains the book content.
 *
 * @implements {Integration}
 */
export class VitalSourceContainerIntegration {
  /**
   * @param {Annotator} annotator
   */
  constructor(annotator) {
    const bookElement = findBookElement();
    if (!bookElement) {
      throw new Error('Book container element not found');
    }

    const shadowRoot = /** @type {ShadowRoot} */ (bookElement.shadowRoot);
    const injectClientIntoContentFrame = () => {
      const frame = shadowRoot.querySelector('iframe');
      if (frame) {
        annotator.injectClient(frame);
      }
    };

    injectClientIntoContentFrame();

    // Re-inject client into content frame after a chapter navigation.
    //
    // We currently don't do any debouncing here and rely on `injectClient` to
    // be idempotent and cheap.
    this._frameObserver = new MutationObserver(injectClientIntoContentFrame);
    this._frameObserver.observe(shadowRoot, { childList: true, subtree: true });
  }

  destroy() {
    this._frameObserver.disconnect();
  }

  canAnnotate() {
    // No part of the container frame can be annotated.
    return false;
  }

  // The methods below are all stubs. Creating annotations is not supported
  // in the container frame.
  async anchor() {
    return new Range();
  }

  /** @return {Selector[]} */
  describe() {
    throw new Error('This frame cannot be annotated');
  }
  contentContainer() {
    return document.body;
  }
  fitSideBySide() {
    return false;
  }
  async getMetadata() {
    return { title: '', link: [] };
  }
  async uri() {
    return document.location.href;
  }
  async scrollToAnchor() {}
}

/**
 * Bounding box of a single character in the page.
 *
 * Coordinates are expressed in percentage distance from the top-left corner
 * of the rendered page.
 *
 * @typedef GlyphBox
 * @prop {number} l
 * @prop {number} r
 * @prop {number} t
 * @prop {number} b
 */

/**
 * @typedef PDFGlyphData
 * @prop {GlyphBox[]} glyphs
 */

/**
 * Data that the VitalSource book reader renders into the page about the
 * content and location of text in the image.
 *
 * @typedef PDFTextData
 * @prop {PDFGlyphData} glyphs - Locations of each text character in the page
 * @prop {string} words - The text in the page
 */

function getPDFPageData() {
  const pageData = /** @type {any} */ (window).innerPageData;
  if (!pageData) {
    return null;
  }
  return /** @type {PDFTextData} */ (pageData);
}

/**
 * Create a transparent text layer on top of the rendered image of the PDF
 * page, using data rendered into the page by VitalSource.
 *
 * This transparent text layer is similar to the one that PDF.js creates for
 * us in our standard PDF viewer.
 *
 * @param {Element} pageImage - Rendered image of the page on which to overlay
 *   the text layer
 * @param {GlyphBox[]} glyphs - Locations of characters on the page
 * @param {string} text - Content of text on the page. Should have the same length
 *   as `glyphs`.
 */
function createPDFTextLayer(pageImage, glyphs, text) {
  if (glyphs.length !== text.length) {
    throw new Error('Glyph box length does not match text length');
  }

  // Create container for text layer and position it above the PDF image.
  const containerParent = /** @type {HTMLElement} */ (pageImage.parentNode);
  const container = document.createElement('hypothesis-text-layer');
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.left = '0';

  // Empirically-determined Z-index value that raises the text layer above
  // other elements on the page so that text in it can be selected.
  container.style.zIndex = '100';

  containerParent.insertBefore(container, pageImage.nextSibling);
  containerParent.style.position = 'relative';

  // Make highlights in text layer darken underlying content in image.
  container.style.mixBlendMode = 'multiply';

  // Set up a canvas for measuring text in the page.
  const canvas = document.createElement('canvas');
  const context = /** @type {CanvasRenderingContext2D} */ (
    canvas.getContext('2d')
  );
  const containerStyle = getComputedStyle(container);
  context.font = `${containerStyle.fontSize} ${containerStyle.fontFamily}`;

  // Create the transparent text layer using data in the page about the text
  // characters and their locations.

  /** @type {GlyphBox|null} */
  let currentWordBox = null;
  let currentWordText = '';

  /**
   * @param {GlyphBox|null} a
   * @param {GlyphBox} b
   */
  const mergeBoxes = (a, b) => {
    if (!a) {
      return b;
    }
    return {
      l: Math.min(a.l, b.l),
      r: Math.max(a.r, b.r),
      t: Math.min(a.t, b.t),
      b: Math.max(a.b, b.b),
    };
  };

  /**
   * @typedef TextBox
   * @prop {HTMLElement} span
   * @prop {GlyphBox} box
   * @prop {number} width - Natural width of the text
   * @prop {number} height - Natural height of the text
   */

  /** @type {TextBox[]} */
  const boxes = [];

  const addCurrentWordToTextLayer = () => {
    if (!currentWordBox) {
      return;
    }

    const span = document.createElement('span');
    span.style.position = 'absolute';
    span.style.color = 'transparent';
    span.style.transformOrigin = 'top left';

    span.textContent = currentWordText;

    container.append(span);
    container.append(' ');

    const tm = context.measureText(currentWordText);
    const textHeight = tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent;

    boxes.push({
      span,
      box: currentWordBox,
      width: tm.width,
      height: textHeight,
    });

    currentWordBox = null;
    currentWordText = '';
  };

  for (let i = 0; i < glyphs.length; i++) {
    const char = text[i];
    if (/\s/.test(char)) {
      addCurrentWordToTextLayer();
      continue;
    }

    const glyph = glyphs[i];
    currentWordBox = mergeBoxes(currentWordBox, glyph);
    currentWordText += char;
  }
  addCurrentWordToTextLayer();

  /**
   * Position and scale the text boxes to fit the current rendered image size.
   */
  const updateBoxSizes = () => {
    const pageWidth = pageImage.getBoundingClientRect().width;
    const pageHeight = pageImage.getBoundingClientRect().height;
    container.style.width = pageWidth + 'px';
    container.style.height = pageHeight + 'px';

    for (let { span, box, width, height } of boxes) {
      const left = (box.l / 100) * pageWidth;
      const top = (box.t / 100) * pageHeight;

      span.style.left = left + 'px';
      span.style.top = top + 'px';

      const right = (box.r / 100) * pageWidth;
      const bottom = (box.b / 100) * pageHeight;
      const scaleX = (right - left) / width;
      const scaleY = (bottom - top) / height;

      span.style.transform = `scale(${scaleX}, ${scaleY})`;
    }
  };

  updateBoxSizes();

  // TODO - Debounce listener and unregister when no longer needed.
  window.addEventListener('resize', () => {
    setTimeout(updateBoxSizes, 50);
  });

  return {
    destroy: () => container.remove(),
  };
}

/**
 * Integration for the content frame in VitalSource's Bookshelf ebook reader.
 *
 * This integration delegates to the standard HTML integration for most
 * functionality, but it adds logic to:
 *
 *  - Customize the document URI and metadata that is associated with annotations
 *  - Prevent VitalSource's built-in selection menu from getting in the way
 *    of the adder.
 *
 * @implements {Integration}
 */
export class VitalSourceContentIntegration {
  /**
   * @param {HTMLElement} container
   */
  constructor(container = document.body) {
    this._htmlIntegration = new HTMLIntegration(container);

    this._listeners = new ListenerCollection();

    // Prevent mouse events from reaching the window. This prevents VitalSource
    // from showing its native selection menu, which obscures the client's
    // annotation toolbar.
    //
    // VitalSource only checks the selection on the `mouseup` and `mouseout` events,
    // but we also need to stop `mousedown` to prevent the client's `SelectionObserver`
    // from thinking that the mouse is held down when a selection change occurs.
    // This has the unwanted side effect of allowing the adder to appear while
    // dragging the mouse.
    const stopEvents = ['mousedown', 'mouseup', 'mouseout'];
    for (let event of stopEvents) {
      this._listeners.add(document.documentElement, event, e => {
        e.stopPropagation();
      });
    }

    // If this is a PDF, create the hidden text layer above the rendered PDF
    // image.
    const bookImage = document.querySelector('#pbk-page');
    const pageData = getPDFPageData();
    if (bookImage && pageData) {
      this._textLayer = createPDFTextLayer(bookImage, pageData.glyphs.glyphs, pageData.words);
    }
  }

  canAnnotate() {
    return true;
  }

  destroy() {
    this._textLayer?.destroy();
    this._listeners.removeAll();
    this._htmlIntegration.destroy();
  }

  /**
   * @param {HTMLElement} root
   * @param {Selector[]} selectors
   */
  anchor(root, selectors) {
    return this._htmlIntegration.anchor(root, selectors);
  }

  /**
   * @param {HTMLElement} root
   * @param {Range} range
   */
  describe(root, range) {
    return this._htmlIntegration.describe(root, range);
  }

  contentContainer() {
    return this._htmlIntegration.contentContainer();
  }

  fitSideBySide() {
    // Not yet implemented
    return false;
  }

  async getMetadata() {
    // Return minimal metadata which includes only the information we really
    // want to include.
    return {
      title: document.title,
      link: [],
    };
  }

  async uri() {
    // An example of a typical URL for the chapter content in the Bookshelf reader is:
    //
    // https://jigsaw.vitalsource.com/books/9781848317703/epub/OPS/xhtml/chapter_001.html#cfi=/6/10%5B;vnd.vst.idref=chap001%5D!/4
    //
    // Where "9781848317703" is the VitalSource book ID ("vbid"), "chapter_001.html"
    // is the location of the HTML page for the current chapter within the book
    // and the `#cfi` fragment identifies the scroll location.
    //
    // Note that this URL is typically different than what is displayed in the
    // iframe's `src` attribute.

    // Strip off search parameters and fragments.
    const uri = new URL(document.location.href);
    uri.search = '';
    return uri.toString();
  }

  /**
   * @param {Anchor} anchor
   */
  async scrollToAnchor(anchor) {
    return this._htmlIntegration.scrollToAnchor(anchor);
  }
}
