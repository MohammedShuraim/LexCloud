# LexCloud

Serverless AI legal advisor for Indian law. Upload contracts and statutes, ask grounded questions, translate into Indian languages, and use voice in and voice out.

This repository is the Cloud Computing (SWE4002) implementation: AWS Lambda, API Gateway, S3, DynamoDB, Textract, Translate, Polly, plus Groq for chat/RAG and Whisper. The static UI is hosted on AWS Amplify.

## Modes

- **RAG** — ask questions about an uploaded PDF
- **Translate** — Hindi, Tamil, Telugu, Malayalam, Kannada
- **Chat** — general Indian-law questions (no document)

## Stack

| Layer | Service |
| --- | --- |
| Hosting | AWS Amplify |
| API | Amazon API Gateway |
| Compute | AWS Lambda (Python 3.12) |
| Documents | Amazon S3 + Amazon Textract |
| Metadata | Amazon DynamoDB |
| Translation | Amazon Translate |
| Speech | Amazon Polly (Aditi) + Groq Whisper |
| LLM | Groq Llama |

## Local frontend

Open `frontend/index.html` after copying `frontend/js/config.example.js` to `frontend/js/config.js` and setting `apiBaseUrl`.

## Deploy

Infrastructure is defined in `template.yaml` (SAM transform) and deployed with AWS CLI in `ap-south-1`. The Groq API key is a stack parameter and is never committed.
