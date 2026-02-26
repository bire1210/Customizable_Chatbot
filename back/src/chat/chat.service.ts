import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { DocumentsService } from 'src/documents/documents.service';
import { VectorService } from 'src/vector/vector.service';

@Injectable()
export class ChatService {

    private readonly generate_url = 'http://localhost:11434/api/generate';
    private readonly model_name = 'phi4-mini';

    constructor(private vector: VectorService, private document: DocumentsService) {}

    async handleMessage(userMessage: string) {
        console.log("here")
        // embed the message into vector
        const generatedMessageVector = await this.vector.createSingleTextVector(userMessage);


        // fetch the vector similar to it
        const similarChunk = await this.document.searchSimilarChunks(generatedMessageVector);

        const contextText = similarChunk
            .map(chunk => chunk.content) // get the content property
            .join('\n\n');              // separate chunks by newlines for readability

        // send relevant message and the context we fetched to ollama
        const prompt = `Answer ONLY using the context below.

                        Context:
                        ${contextText}

                        Question:
                        ${userMessage}

                        Answer:
                        `
        const response = await axios.post(this.generate_url, {
                        model: this.model_name,
                        prompt: prompt,
                        stream: false,
                    });
        console.log(response)

        return response.data.response as string;
        // return ollamas response based on the message and relevant chunks
    }
}
