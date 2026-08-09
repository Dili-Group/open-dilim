import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { AGENT_SECTION } from "@/content/copy";

export function AgentSection() {
  return (
    <section className="section-pad border-t border-border-subtle">
      <div className="container-content">
        <p className="eyebrow">{AGENT_SECTION.eyebrow}</p>

        <div className="mt-4 grid gap-x-12 gap-y-4 md:grid-cols-12 md:items-end">
          <h2 className="text-balance text-h1 text-strong md:col-span-7">
            {AGENT_SECTION.heading}
          </h2>
          <p className="text-body-lg text-body md:col-span-5">{AGENT_SECTION.lead}</p>
        </div>

        {/* Card KHÔNG đặt `interactive`: nó không bấm được. Hiệu ứng nâng khi rê chuột
            trên khối tĩnh là lời hứa suông — người dùng bấm vào rồi không có gì xảy ra. */}
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AGENT_SECTION.cards.map((agent) => (
            <Card key={agent.name}>
              <Icon name={agent.icon as IconName} className="text-accent" />
              <h3 className="mt-4 text-h3 text-strong">{agent.name}</h3>
              <p className="mono-label mt-1 text-muted">{agent.where}</p>
              <p className="mt-3 text-body">{agent.does}</p>
            </Card>
          ))}
        </div>

        <dl className="mt-12 grid gap-8 border-t border-border-strong pt-10 md:grid-cols-3">
          {AGENT_SECTION.notes.map((note) => (
            <div key={note.title}>
              <dt className="text-h3 font-medium text-strong">{note.title}</dt>
              <dd className="mt-2 text-body">{note.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
