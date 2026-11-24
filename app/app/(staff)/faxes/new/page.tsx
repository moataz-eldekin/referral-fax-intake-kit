import { connection } from "next/server";
import { NewFaxForm } from "@/components/fax/NewFaxForm";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { listSamples } from "@/lib/samples";

export default async function NewFaxPage() {
  await connection();
  await requirePageUser("coordinator");
  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-[1280px] px-6 pt-10 pb-10">
        <PageHeading before="Add a" highlight="fax">
          The app reads every page, works out what the fax is, pulls out the referral, checks what is missing and puts it in the right queue.
        </PageHeading>
      </section>
      <section className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-10">
          <NewFaxForm samples={await listSamples()} />
        </div>
      </section>
    </div>
  );
}
