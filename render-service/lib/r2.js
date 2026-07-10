import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";

let client;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export async function uploadBuffer(buffer, key, contentType) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

export async function uploadFile(localPath, key, contentType) {
  return uploadBuffer(fs.readFileSync(localPath), key, contentType);
}
