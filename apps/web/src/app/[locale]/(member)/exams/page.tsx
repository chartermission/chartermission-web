import { redirect } from "next/navigation";

/** Exams have no page of their own any more: the ones a member was invited to are on Learning. */
export default function ExamsPage() {
  redirect("/learning");
}
