import { QueryRewriterService } from './query-rewriter.service';

describe('QueryRewriterService', () => {
  let service: QueryRewriterService;

  beforeEach(() => {
    service = new QueryRewriterService();
  });

  it('removes conversational wrappers from the primary query', async () => {
    const variants = await service.buildQueryVariants('Please tell me about vector search');
    expect(variants[0]).toBe('vector search');
  });

  it('removes an according-to source wrapper', async () => {
    const variants = await service.buildQueryVariants("According to Kaleab's CV, identify his chatbot contributions");
    expect(variants[0]).toBe('identify his chatbot contributions');
  });

  it('adds a keyword-focused variant', async () => {
    const variants = await service.buildQueryVariants('What is the final GPA in the document?');
    expect(variants).toContain('final gpa document');
  });

  it('decomposes compound questions', async () => {
    const variants = await service.buildQueryVariants('training size and test size');
    expect(variants).toContain('training size');
    expect(variants).toContain('test size');
  });

  it('never returns more than the configured maximum variants', async () => {
    const variants = await service.buildQueryVariants('compare GPA and exit exam, then list project scores');
    expect(variants.length).toBeLessThanOrEqual(4);
  });
});
