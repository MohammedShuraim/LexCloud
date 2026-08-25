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

After a stack create, attach the S3 upload trigger (CloudFormation cannot do this in the same stack as the API without a circular dependency):

```
aws lambda add-permission --function-name LexCloudProcessor --principal s3.amazonaws.com --statement-id AllowLexCloudS3Invoke --action lambda:InvokeFunction --source-arn arn:aws:s3:::lexcloud-uploads-ACCOUNT --source-account ACCOUNT --region ap-south-1
aws s3api put-bucket-notification-configuration --bucket lexcloud-uploads-ACCOUNT --notification-configuration file://s3-notify.json --region ap-south-1
```

Amplify Hosting builds `frontend/` and writes `js/config.js` from `LEXCLOUD_API_BASE_URL`.

Current API base URL: `https://pvkvjvq3pj.execute-api.ap-south-1.amazonaws.com/prod`

Live app: [https://main.d2pw2pic3w5m1.amplifyapp.com](https://main.d2pw2pic3w5m1.amplifyapp.com)

If Amazon Textract or Amazon Translate are not subscribed on the account, the processor falls back to pypdf and Groq translation so the demo still runs. Enable those services in the AWS console to use the native APIs.
