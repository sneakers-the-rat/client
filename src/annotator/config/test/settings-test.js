import settingsFrom from '../settings';
import { $imports } from '../settings';

describe('annotator/config/settingsFrom', () => {
  let fakeConfigFuncSettingsFrom;
  let fakeIsBrowserExtension;
  let fakeParseJsonConfig;
  let fakeUrlFromLinkTag;

  beforeEach(() => {
    fakeConfigFuncSettingsFrom = sinon.stub().returns({});
    fakeIsBrowserExtension = sinon.stub().returns(false);
    fakeUrlFromLinkTag = sinon.stub().returns('http://example.com/app.html');
    fakeParseJsonConfig = sinon.stub().returns({});

    $imports.$mock({
      './config-func-settings-from': fakeConfigFuncSettingsFrom,
      './is-browser-extension': fakeIsBrowserExtension,
      './url-from-link-tag': {
        urlFromLinkTag: fakeUrlFromLinkTag,
      },
      '../../boot/parse-json-config': { parseJsonConfig: fakeParseJsonConfig },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  describe('#notebookAppUrl', () => {
    it('calls urlFromLinkTag with appropriate params', () => {
      assert.exists(settingsFrom(window).notebookAppUrl);
      assert.calledWith(
        fakeUrlFromLinkTag,
        // ignore window object
        sinon.match.any,
        'notebook',
        'html'
      );
    });
  });

  describe('#sidebarAppUrl', () => {
    it('calls urlFromLinkTag with appropriate params', () => {
      assert.exists(settingsFrom(window).sidebarAppUrl);
      assert.calledWith(
        fakeUrlFromLinkTag,
        // ignore window object
        sinon.match.any,
        'sidebar',
        'html'
      );
    });
  });

  describe('#clientUrl', () => {
    it('calls urlFromLinkTag with appropriate params', () => {
      assert.exists(settingsFrom(window).clientUrl);
      assert.calledWith(
        fakeUrlFromLinkTag,
        // ignore window object
        sinon.match.any,
        'hypothesis-client',
        'javascript'
      );
    });
  });

  function fakeWindow(href) {
    return {
      location: {
        href: href,
      },
      document: {
        querySelector: sinon.stub().returns({ href: 'hi' }),
      },
    };
  }

  describe('#annotations', () => {
    context(
      'when the host page has a js-hypothesis-config with an annotations setting',
      () => {
        beforeEach('add a js-hypothesis-config annotations setting', () => {
          fakeParseJsonConfig.returns({
            annotations: 'annotationsFromJSON',
          });
        });

        it('returns the annotations from the js-hypothesis-config script', () => {
          assert.equal(
            settingsFrom(fakeWindow()).annotations,
            'annotationsFromJSON'
          );
        });

        context(
          "when there's also an `annotations` in the URL fragment",
          () => {
            specify(
              'js-hypothesis-config annotations override URL ones',
              () => {
                const window_ = fakeWindow(
                  'http://localhost:3000#annotations:annotationsFromURL'
                );

                assert.equal(
                  settingsFrom(window_).annotations,
                  'annotationsFromJSON'
                );
              }
            );
          }
        );
      }
    );

    [
      {
        describe: "when there's a valid #annotations:<ID> fragment",
        it: 'returns an object containing the annotation ID',
        url: 'http://localhost:3000#annotations:alphanum3ric_-only',
        returns: 'alphanum3ric_-only',
      },
      {
        describe: "when there's a non-alphanumeric annotation ID",
        it: 'returns null',
        url: 'http://localhost:3000#annotations:not%20alphanumeric',
        returns: null,
      },
      {
        describe: "when there's an unrecognised URL fragment",
        it: 'returns null',
        url: 'http://localhost:3000#unknown',
        returns: null,
      },
      {
        describe: "when there's no URL fragment",
        it: 'returns null',
        url: 'http://localhost:3000',
        returns: null,
      },
    ].forEach(function (test) {
      describe(test.describe, () => {
        it(test.it, () => {
          assert.deepEqual(
            settingsFrom(fakeWindow(test.url)).annotations,
            test.returns
          );
        });
      });
    });
  });

  [
    {
      description:
        "returns an object with the group ID when there's a valid #annotations:group:<ID> fragment",
      url: 'http://localhost:3000#annotations:group:alphanum3ric_-only',
      returns: 'alphanum3ric_-only',
    },
    {
      description: "returns null when there's a non-alphanumeric group ID",
      url: 'http://localhost:3000#annotations:group:not%20alphanumeric',
      returns: null,
    },
    {
      description: "return null when there's an empty group ID",
      url: 'http://localhost:3000#annotations:group:',
      returns: null,
    },
  ].forEach(test => {
    it(test.description, () => {
      assert.deepEqual(settingsFrom(fakeWindow(test.url)).group, test.returns);
    });
  });

  describe('#query', () => {
    context(
      'when the host page has a js-hypothesis-config with a query setting',
      () => {
        beforeEach('add a js-hypothesis-config query setting', () => {
          fakeParseJsonConfig.returns({
            query: 'queryFromJSON',
          });
        });

        it('returns the query from the js-hypothesis-config script', () => {
          assert.equal(settingsFrom(fakeWindow()).query, 'queryFromJSON');
        });

        context("when there's also a query in the URL fragment", () => {
          specify('js-hypothesis-config queries override URL ones', () => {
            const window_ = fakeWindow(
              'http://localhost:3000#annotations:query:queryFromUrl'
            );

            assert.equal(settingsFrom(window_).query, 'queryFromJSON');
          });
        });
      }
    );

    [
      {
        describe: "when there's a #annotations:query:<QUERY> fragment",
        it: 'returns an object containing the query',
        url: 'http://localhost:3000#annotations:query:user:fred',
        returns: 'user:fred',
      },
      {
        describe: "when there's a #annotations:q:<QUERY> fragment",
        it: 'returns an object containing the query',
        url: 'http://localhost:3000#annotations:q:user:fred',
        returns: 'user:fred',
      },
      {
        describe: "when there's a #annotations:QuerY:<QUERY> fragment",
        it: 'returns an object containing the query',
        url: 'http://localhost:3000#annotations:QuerY:user:fred',
        returns: 'user:fred',
      },
      {
        describe: 'when the query contains both a username and a tag',
        it: 'returns an object containing the query',
        url: 'http://localhost:3000#annotations:q:user:fred%20tag:foo',
        returns: 'user:fred tag:foo',
      },
      {
        describe: 'when the query contains URI escape sequences',
        it: 'decodes the escape sequences',
        url: 'http://localhost:3000#annotations:query:user%3Ajsmith%20bar',
        returns: 'user:jsmith bar',
      },
      {
        describe: "when there's an unrecognised URL fragment",
        it: 'returns null',
        url: 'http://localhost:3000#unknown',
        returns: null,
      },
      {
        describe: "when there's no URL fragment",
        it: 'returns null',
        url: 'http://localhost:3000',
        returns: null,
      },
    ].forEach(function (test) {
      describe(test.describe, () => {
        it(test.it, () => {
          assert.deepEqual(
            settingsFrom(fakeWindow(test.url)).query,
            test.returns
          );
        });
      });
    });

    describe('when the URL contains an invalid fragment', () => {
      it('returns null', () => {
        // An invalid escape sequence which will cause decodeURIComponent() to
        // throw a URIError.
        const invalidFrag = '%aaaaa';

        const url = 'http://localhost:3000#annotations:query:' + invalidFrag;

        assert.isNull(settingsFrom(fakeWindow(url)).query);
      });
    });
  });

  describe('#showHighlights', () => {
    [
      {
        it: 'returns an "always" setting from the host page unmodified',
        input: 'always',
        output: 'always',
      },
      {
        it: 'returns a "never" setting from the host page unmodified',
        input: 'never',
        output: 'never',
      },
      {
        it: 'returns a "whenSidebarOpen" setting from the host page unmodified',
        input: 'whenSidebarOpen',
        output: 'whenSidebarOpen',
      },
      {
        it: 'changes true to "always"',
        input: true,
        output: 'always',
      },
      {
        it: 'changes false to "never"',
        input: false,
        output: 'never',
      },
      {
        it: 'passes invalid string values through unmodified',
        input: 'invalid',
        output: 'invalid',
      },
      {
        it: 'passes numbers through unmodified',
        input: 42,
        output: 42,
      },
      // If the host page sets showHighlights to null this will be mistaken
      // for the host page not containing a showHighlights setting at all and
      // showHighlights will be set to 'always'.
      {
        it: 'defaults to "always"',
        input: null,
        output: 'always',
      },
      {
        it: 'passes undefined through unmodified',
        input: undefined,
        output: undefined,
      },
      {
        it: 'passes arrays through unmodified',
        input: [1, 2, 3],
        output: [1, 2, 3],
      },
      {
        it: 'passes objects through unmodified',
        input: { foo: 'bar' },
        output: { foo: 'bar' },
      },
      {
        it: 'passes regular expressions through unmodified',
        input: /regex/,
        output: /regex/,
      },
    ].forEach(function (test) {
      it(test.it, () => {
        fakeParseJsonConfig.returns({
          showHighlights: test.input,
        });
        const settings = settingsFrom(fakeWindow());

        assert.deepEqual(settings.showHighlights, test.output);
      });

      it(test.it, () => {
        fakeConfigFuncSettingsFrom.returns({
          showHighlights: test.input,
        });
        const settings = settingsFrom(fakeWindow());

        assert.deepEqual(settings.showHighlights, test.output);
      });
    });

    it("defaults to 'always' if there's no showHighlights setting in the host page", () => {
      assert.equal(settingsFrom(fakeWindow()).showHighlights, 'always');
    });

    context('when the client is in a browser extension', () => {
      beforeEach('configure a browser extension client', () => {
        fakeIsBrowserExtension.returns(true);
      });

      it("doesn't read the setting from the host page, defaults to 'always'", () => {
        fakeParseJsonConfig.returns({
          showHighlights: 'never',
        });
        fakeConfigFuncSettingsFrom.returns({
          showHighlights: 'never',
        });

        assert.equal(settingsFrom(fakeWindow()).showHighlights, 'always');
      });
    });
  });

  describe('#hostPageSetting', () => {
    [
      {
        when: 'the client is embedded in a web page',
        specify: 'it returns setting values from window.hypothesisConfig()',
        isBrowserExtension: false,
        configFuncSettings: { foo: 'configFuncValue' },
        jsonSettings: {},
        expected: 'configFuncValue',
      },
      {
        when: 'the client is embedded in a web page',
        specify: 'it returns setting values from js-hypothesis-config objects',
        isBrowserExtension: false,
        configFuncSettings: {},
        jsonSettings: { foo: 'jsonValue' },
        expected: 'jsonValue',
      },
      {
        when: 'the client is embedded in a web page',
        specify:
          'hypothesisConfig() settings override js-hypothesis-config ones',
        isBrowserExtension: false,
        configFuncSettings: { foo: 'configFuncValue' },
        jsonSettings: { foo: 'jsonValue' },
        expected: 'configFuncValue',
      },
      {
        when: 'the client is embedded in a web page',
        specify:
          'even a null from hypothesisConfig() overrides js-hypothesis-config',
        isBrowserExtension: false,
        configFuncSettings: { foo: null },
        jsonSettings: { foo: 'jsonValue' },
        expected: null,
      },
      {
        when: 'the client is embedded in a web page',
        specify:
          'even an undefined from hypothesisConfig() overrides js-hypothesis-config',
        isBrowserExtension: false,
        configFuncSettings: { foo: undefined },
        jsonSettings: { foo: 'jsonValue' },
        expected: undefined,
      },
      {
        when: 'the client is in a browser extension',
        specify: 'it always returns null',
        isBrowserExtension: true,
        configFuncSettings: { foo: 'configFuncValue' },
        jsonSettings: { foo: 'jsonValue' },
        expected: null,
      },
      {
        when: 'the client is in a browser extension and allowInBrowserExt: true is given',
        specify: 'it returns settings from window.hypothesisConfig()',
        isBrowserExtension: true,
        allowInBrowserExt: true,
        configFuncSettings: { foo: 'configFuncValue' },
        jsonSettings: {},
        expected: 'configFuncValue',
      },
      {
        when: 'the client is in a browser extension and allowInBrowserExt: true is given',
        specify: 'it returns settings from js-hypothesis-configs',
        isBrowserExtension: true,
        allowInBrowserExt: true,
        configFuncSettings: {},
        jsonSettings: { foo: 'jsonValue' },
        expected: 'jsonValue',
      },
      {
        when: 'no default value is provided',
        specify: 'it returns null',
        isBrowserExtension: false,
        allowInBrowserExt: false,
        configFuncSettings: {},
        jsonSettings: {},
        defaultValue: undefined,
        expected: null,
      },
      {
        when: 'a default value is provided',
        specify: 'it returns that default value',
        isBrowserExtension: false,
        allowInBrowserExt: false,
        configFuncSettings: {},
        jsonSettings: {},
        defaultValue: 'test value',
        expected: 'test value',
      },
      {
        when: 'a default value is provided but it is overridden',
        specify: 'it returns the overridden value',
        isBrowserExtension: false,
        allowInBrowserExt: false,
        configFuncSettings: { foo: 'not the default value' },
        jsonSettings: {},
        defaultValue: 'the default value',
        expected: 'not the default value',
      },
      {
        when: 'the client is in a browser extension and a default value is provided',
        specify: 'it returns the default value',
        isBrowserExtension: true,
        allowInBrowserExt: false,
        configFuncSettings: { foo: 'ignore me' },
        jsonSettings: { foo: 'also ignore me' },
        defaultValue: 'the default value',
        expected: 'the default value',
      },
    ].forEach(function (test) {
      context(test.when, () => {
        specify(test.specify, () => {
          fakeIsBrowserExtension.returns(test.isBrowserExtension);
          fakeConfigFuncSettingsFrom.returns(test.configFuncSettings);
          fakeParseJsonConfig.returns(test.jsonSettings);
          const settings = settingsFrom(fakeWindow());

          const setting = settings.hostPageSetting('foo', {
            allowInBrowserExt: test.allowInBrowserExt || false,
            defaultValue: test.defaultValue || null,
          });

          assert.strictEqual(setting, test.expected);
        });
      });
    });
  });
});
