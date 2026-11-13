import type { ExamSummary } from "@chartermission/contracts";
import { ExamCard } from "./exam-card";
import { settle } from "@/components/social/data";
import { apiGet } from "@/lib/api/server";

/**
 * The exams the member was invited to (GET /exams), on the Learning page and on its locked screen:
 * an invited exam can always be taken, whether or not e-learning is unlocked. Nothing shows for
 * members without exams, or if the list can't load.
 */
export async function YourExams() {
  const exams = await settle(apiGet<ExamSummary[]>("/exams"));
  if (!exams.ok || !exams.data.length) return null;
  return (
    <section aria-labelledby="your-exams-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="your-exams-heading" className="text-h2 text-ink">
          Your exams
        </h2>
        <p className="text-sm text-secondary">Exams you were invited to take. Your score comes as soon as you finish.</p>
      </div>
      <ul className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {exams.data.map((exam) => (
          <li key={exam.id} className="flex">
            <ExamCard exam={exam} />
          </li>
        ))}
      </ul>
    </section>
  );
}
