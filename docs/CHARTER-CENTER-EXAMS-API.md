# Charter Center API for exams

One endpoint Charter Mission calls on Charter Center: the certificate for someone who passed an exam.

```
POST https://charter-center.com/api/partner/certificate
Content-Type: application/json
Authorization: Bearer <CHARTER_CENTER_API_KEY>      (only sent when a key is set)

{
  "student_name": "Rais ur Rehman",
  "course_title": "PMP Exam Prep",
  "start_from": "2026-01-01",
  "start_end": "2026-01-15",
  "duration": 35,
  "exam_hours": 35,
  "instructor_name": "Eng. Abdalla Yousif",
  "instructor_signature_url": "https://chartermission.com/api/v1/exam-signatures/0b6c1c5e-8a55-4b8e-9d0e-2f1d1f6b0a11.png"
}
```

- `student_name`: the name the member confirmed for their certificate. After passing, members are asked to
  confirm the name to print (their profile name, or another name an admin approves); nothing is sent until
  they have.
- `course_title`, `start_from`, `start_end`, `instructor_name`: the exam's certificate settings in the
  Charter Mission admin console. Dates are `YYYY-MM-DD`.
- `duration`: the study hours set on the exam's certificate, a number (up to one decimal place,
  like `35` or `1.5`), or `null` when the exam has no hours set. This is the name in Charter Center's
  partner API collection (Nov 2026).
- `exam_hours`: the same value under the name Charter Mission used first; it can be ignored.
- `instructor_signature_url`: the signature uploaded on the exam, publicly downloadable (PNG, JPEG or WebP).

The request is sent once per member and exam, as soon as the member has confirmed their name. The
details are fixed then, so a retry sends exactly the same thing. (When an issued certificate is
corrected, the same request is sent again with the corrected details, and the new certificate replaces
the old one.)

## What Charter Mission accepts back

Any of these works; nothing else needs to change on Charter Center's side.

1. **The file itself**: `200` with `Content-Type: application/pdf` (the certificate PDF) or `image/png` / `image/jpeg`.
2. **JSON with links**, for example:

   ```json
   {
     "certificate_id": "CC-2026-000123",
     "pdf_url": "https://charter-center.com/certificates/CC-2026-000123.pdf",
     "image_url": "https://charter-center.com/certificates/CC-2026-000123.png"
   }
   ```

   Links are also read from `certificate_url`, `download_url`, `file_url`, `url`, and the reference from
   `certificate_number` or `id`. A `{ "data": { … } }` wrapper is fine. Links must be publicly
   downloadable HTTPS addresses (signed links are fine if they last at least 10 minutes).
3. **JSON with the PDF in base64** (`pdf`, `pdf_base64` or `file`, with or without a `data:application/pdf;base64,` prefix).

When only a PDF comes back, Charter Mission makes the picture for the feed from its first page; when only a
picture comes back, it makes the PDF. Sizes: PDF up to 10 MB, picture up to 15 MB.

**404** means the certificate isn't ready yet: Charter Mission asks again after 1 min, 5 min, 15 min, 1 h,
3 h, 6 h, 12 h and 24 h. Other errors (401, 403, 422, 5xx) are kept for the admin to see and retried on the
same schedule; an admin can also ask again from the exam's Results.

## Turning it on

Set on the API: `CHARTER_CENTER_EXAMS_API=live` (and `CHARTER_CENTER_API_KEY` if Charter Center gives one).
`CHARTER_CENTER_API_URL` defaults to `https://charter-center.com/api/partner`.

Until then (`CHARTER_CENTER_EXAMS_API=mock`) sample certificates are made away from the live site (a member
whose name contains `pending` waits for theirs); on the live site nothing is issued and certificates wait.
