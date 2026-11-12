# Charter Center API for exams

Two endpoints Charter Mission calls on Charter Center. Base URL and key are the ones already used
for the course catalogue: `CHARTER_CENTER_API_URL` and `CHARTER_CENTER_API_KEY`.

Every request: `POST`, JSON body, headers `Authorization: Bearer <key>` and `Content-Type: application/json`.

## 1. Student lookup

Called when someone opens an exam invitation and enters their email.

```
POST {CHARTER_CENTER_API_URL}/students/lookup
{ "email": "amina.yusuf@gmail.com" }
```

**200**, a student with this email:

```json
{
  "name": "Amina Yusuf",
  "photo_url": "https://charter-center.com/storage/avatars/123.jpg"
}
```

`photo_url` is `null` when there is no photo. **404** when no student has this email.

## 2. Certificate

Called when a member passes an exam. `course_id` is the Charter Center course ID entered on the exam.

```
POST {CHARTER_CENTER_API_URL}/certificates
{ "email": "amina.yusuf@gmail.com", "course_id": "capm-101" }
```

**200**, the student's certificate for the course:

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

- Emails are sent lower-case; match them case-insensitively.
- `photo_url`, `pdf_url` and `image_url` must be publicly downloadable HTTPS links (signed links are
  fine if they last at least 10 minutes). Photo up to 8 MB; image up to 15 MB (JPG or PNG); PDF up to 10 MB.
- Field names in camelCase (`photoUrl`, `certificateId`…) and a `{ "data": { … } }` wrapper are also accepted.
- Errors other than 404 (401, 403, 5xx) are treated as "try again later", never as "not a student".

## Turning it on

Until these endpoints are live, Charter Mission runs with sample data (`CHARTER_CENTER_EXAMS_API=mock`):
any email is a student, except emails starting with `unknown`; emails containing `pending` wait for
their certificate. Set `CHARTER_CENTER_EXAMS_API=live` on the API to use Charter Center.
