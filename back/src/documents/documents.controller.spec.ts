import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  const documentsService = {
    createAndIngestDocument: jest.fn(),
    getDocuments: jest.fn(),
    getDocumentById: jest.fn(),
    getDocumentChunks: jest.fn(),
    deleteDocument: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: documentsService }],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes an uploaded file and title to ingestion', async () => {
    const file = { originalname: 'guide.pdf' } as Express.Multer.File;
    documentsService.createAndIngestDocument.mockResolvedValue({ id: 'doc' });
    await expect(controller.uploadDocument(file, 'Guide')).resolves.toEqual({ id: 'doc' });
    expect(documentsService.createAndIngestDocument).toHaveBeenCalledWith({ file, title: 'Guide' });
  });

  it('returns document chunks', async () => {
    documentsService.getDocumentChunks.mockResolvedValue([{ id: 'chunk' }]);
    await expect(controller.getDocumentChunks('doc')).resolves.toEqual([{ id: 'chunk' }]);
    expect(documentsService.getDocumentChunks).toHaveBeenCalledWith('doc');
  });

  it('deletes the selected document', async () => {
    documentsService.deleteDocument.mockResolvedValue(undefined);
    await controller.deleteDocument('doc');
    expect(documentsService.deleteDocument).toHaveBeenCalledWith('doc');
  });
});
