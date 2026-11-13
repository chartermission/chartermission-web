# Charter Center API for exams

One endpoint Charter Mission calls on Charter Center: the certificate for someone who passed an exam.
Base URL and key are the ones already used for the course catalogue: `CHARTER_CENTER_API_URL` and
`CHARTER_CENTER_API_KEY`.

The request: `POST`, JSON body, headers `Authorization: Bearer <key>` and `Content-Type: application/json`.

## Certificate

Called when a member passes an exam on Charter Mission. Every exam awards a certificate.

```
POST {CHARTER_CENTER_API_URL}/certificates
{
  "email": "amina.yusuf@gmail.com",
  "name": "Amina Yusuf",
  "exam_title": "CAPM® Practice Exam — 50 Questions"
}
```

- `email`: the member's Charter Mission sign-in email, lower-case.
- `name`: the member's name as shown on their Charter Mission profile (print this on the certificate).
- `exam_title`: the title of the exam they passed, as written in the Charter Mission admin console.

**200**, the certificate:

```json
{
  "certificate_id": "CC-2026-000123",
  "pdf_url": "https://charter-center.com/certificates/CC-2026-000123.pdf",
  "image_url": "https://charter-center.com/certificates/CC-2026-000123.png"
}
```

**404** when the certificate isn't ready yet. Charter Mission asks again (after 1 min, 5 min,
15 min, 1 h, 3 h, 6 h, 12 h, 24 h), so it can be issued later.

## Notes

- One certificate per member and exam: Charter Mission asks once per passed exam (plus the retries above).
  Answering the same request twice with the same certificate is fine.
- `pdf_url` and `image_url` must be publicly downloadable HTTPS links (signed links are fine if they
  last at least 10 minutes). Image up to 15 MB (JPG or PNG); PDF up to 10 MB.
- Field names in camelCase (`examTitle`, `certificateId`…) and a `{ "data": { … } }` wrapper are also accepted
  in the answer.
- Errors other than 404 (401, 403, 5xx) are treated as "try again later".

## Turning it on

Until this endpoint is live, Charter Mission runs with sample certificates (`CHARTER_CENTER_EXAMS_API=mock`)
outside production: a sample certificate is made on request, and emails containing `pending` wait for
theirs. On the live site the mock issues nothing: certificates stay pending, and are fetched within an
hour of setting `CHARTER_CENTER_EXAMS_API=live` on the API.
