import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	UploadedFile,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { DocumentsService } from './documents.service';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ApiBadRequestResponse, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { DocumentChunkDto, DocumentDto } from './Dtos/documents.dtos';

@Controller('documents')
export class DocumentsController {
	constructor(private readonly documentsService: DocumentsService) {}

	@Post('upload')
    @ApiOperation({ summary: 'Upload and ingest a document for RAG' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
        type: 'object',
        properties: {
            file: {
            type: 'string',
            format: 'binary',
            },
            title: {
            type: 'string',
            example: 'Company handbook',
            },
        },
        required: ['file'],
        },
    })
    @ApiCreatedResponse({
        description: 'Document uploaded and ingested',
        type: DocumentDto,
    })
    @ApiBadRequestResponse({
        description: 'Invalid file or unsupported format',
    })
	@UseInterceptors(FileInterceptor('file', buildMulterOptions()))
	async uploadDocument(
		@UploadedFile() file: Express.Multer.File,
		@Body('title') title?: string,
	) {
		return this.documentsService.createAndIngestDocument({ file, title });
	}

	@Get()
    @ApiOperation({ summary: 'List all uploaded documents' })
    @ApiOkResponse({
        description: 'List of documents',
        type: [DocumentDto],
    })
	async getDocuments() {
		return this.documentsService.getDocuments();
	}

	@Get(':id')
    @ApiOperation({ summary: 'Get document metadata by ID' })
    @ApiParam({ name: 'id', example: 'uuid' })
    @ApiOkResponse({
        description: 'Document metadata',
        type: DocumentDto,
    })
	async getDocumentById(@Param('id') id: string) {
		return this.documentsService.getDocumentById(id);
	}

	@Get(':id/chunks')
    @ApiOperation({ summary: 'Get all chunks for a document' })
    @ApiParam({ name: 'id', example: 'uuid' })
    @ApiOkResponse({
        description: 'Document chunks',
        type: [DocumentChunkDto],
    })
	async getDocumentChunks(@Param('id') id: string) {
		return this.documentsService.getDocumentChunks(id);
	}

	@Delete(':id')
	@ApiOperation({ summary: 'Delete a document and its chunks' })
	@ApiParam({ name: 'id', example: 'uuid' })
	@ApiOkResponse({
		description: 'Document deleted successfully',
	})
	async deleteDocument(@Param('id') id: string) {
		return this.documentsService.deleteDocument(id);
	}
	
}

function buildMulterOptions() {
	const uploadDir = join(process.cwd(), 'external_documents');
	if (!existsSync(uploadDir)) {
		mkdirSync(uploadDir, { recursive: true });
	}

	return {
		storage: diskStorage({
			destination: uploadDir,
			filename: (req, file, cb) => {
				const extension = extname(file.originalname) || '';
				const basename = file.originalname
					.replace(extension, '')
					.replace(/[^a-zA-Z0-9-_]/g, '_')
					.slice(0, 50);
				const timestamp = Date.now();
				cb(null, `${basename || 'document'}-${timestamp}${extension}`);
			},
		}),
		fileFilter: (req, file, cb) => {
			const extension = extname(file.originalname).toLowerCase();
			const allowed = ['.pdf', '.html', '.htm', '.md', '.markdown', '.txt'];
			if (!allowed.includes(extension)) {
				return cb(
					new BadRequestException(`Unsupported file type: ${extension || 'unknown'}`),
					false,
				);
			}
			cb(null, true);
		},
		limits: {
			fileSize: 20 * 1024 * 1024,
		},
	};
}
