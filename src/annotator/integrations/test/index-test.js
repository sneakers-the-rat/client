import { createIntegration, $imports } from '../index';

describe('createIntegration', () => {
  let FakeHTMLIntegration;
  let FakePDFIntegration;
  let FakeVitalSourceContainerIntegration;
  let FakeVitalSourceContentIntegration;
  let fakeIsPDF;
  let fakeVitalSourceFrameRole;

  beforeEach(() => {
    FakeHTMLIntegration = sinon.stub();
    FakePDFIntegration = sinon.stub();
    fakeIsPDF = sinon.stub().returns(false);

    fakeVitalSourceFrameRole = sinon.stub().returns(null);
    FakeVitalSourceContainerIntegration = sinon.stub();
    FakeVitalSourceContentIntegration = sinon.stub();

    $imports.$mock({
      './html': { HTMLIntegration: FakeHTMLIntegration },
      './pdf': { PDFIntegration: FakePDFIntegration, isPDF: fakeIsPDF },
      './vitalsource': {
        VitalSourceContainerIntegration: FakeVitalSourceContainerIntegration,
        VitalSourceContentIntegration: FakeVitalSourceContentIntegration,
        vitalSourceFrameRole: fakeVitalSourceFrameRole,
      },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  it('creates PDF integration in the PDF.js viewer', () => {
    const annotator = {};
    fakeIsPDF.returns(true);

    const integration = createIntegration(annotator);

    assert.calledWith(FakePDFIntegration, annotator);
    assert.instanceOf(integration, FakePDFIntegration);
  });

  it('creates VitalSource container integration in the VS Bookshelf reader', () => {
    const annotator = {};
    fakeVitalSourceFrameRole.returns('container');

    const integration = createIntegration(annotator);

    assert.calledWith(FakeVitalSourceContainerIntegration, annotator);
    assert.instanceOf(integration, FakeVitalSourceContainerIntegration);
  });

  it('creates VitalSource content integration in the VS Bookshelf reader', () => {
    const annotator = {};
    fakeVitalSourceFrameRole.returns('content');

    const integration = createIntegration(annotator);

    assert.calledWith(FakeVitalSourceContentIntegration);
    assert.instanceOf(integration, FakeVitalSourceContentIntegration);
  });

  it('creates HTML integration in web pages', () => {
    const annotator = {};

    const integration = createIntegration(annotator);

    assert.calledWith(FakeHTMLIntegration);
    assert.instanceOf(integration, FakeHTMLIntegration);
  });
});
