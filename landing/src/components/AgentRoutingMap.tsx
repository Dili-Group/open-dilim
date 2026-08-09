"use client";

import { createRef, useRef, useState } from "react";

import { AnimatedBeam } from "@/components/ui/animated-beam";
import { Icon, type IconName } from "@/components/ui/Icon";
import { LogoMark } from "@/components/ui/Logo";
import { AGENT_ROUTING } from "@/content/copy";

// Sơ đồ định tuyến: Đại lý → DiLiM (điều phối) → root agent chuyên trách.
// Client component vì đường nối đo vị trí DOM thật của từng node (Magic UI
// AnimatedBeam) thay vì toạ độ viewBox cứng — node xê dịch theo breakpoint là
// đường tự vẽ lại.

/** Tia chạy hết một lượt trong bao lâu, và độ trễ giữa các tia cạnh nhau. */
const BEAM_DURATION_S = 3.2;
const BEAM_STAGGER_S = 0.26;

/**
 * Khớp với màn mở đầu hero: card hiện ở 520ms + 420ms animation → tia bắt đầu chạy
 * khi sơ đồ đã đứng yên. Tia vào (đại lý → hub) chạy trước, tia ra tiếp ngay sau.
 */
const INBOUND_DELAY_S = 0.95;
const OUTBOUND_DELAY_S = INBOUND_DELAY_S + 0.6;

function NodeCircle({
  nodeRef,
  children,
  size = "md",
}: {
  readonly nodeRef: React.Ref<HTMLDivElement>;
  readonly children: React.ReactNode;
  readonly size?: "md" | "lg";
}) {
  const box =
    size === "lg"
      ? "h-12 w-12 sm:h-16 sm:w-16 border-brand bg-brand-light"
      : "h-9 w-9 sm:h-12 sm:w-12 border-border-strong bg-surface-card";
  return (
    <div
      ref={nodeRef}
      className={`flex shrink-0 items-center justify-center rounded-full border shadow-card ${box}`}
    >
      {children}
    </div>
  );
}

export function AgentRoutingMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  // Số node cố định theo dữ liệu → tạo ref một lần, không tạo lại mỗi lần render.
  //
  // useState (lazy init) chứ KHÔNG useRef: mảng này phải ĐỌC ĐƯỢC lúc render để phát ref xuống
  // node và dựng đường nối, mà đọc `.current` lúc render là thứ react-hooks/refs chặn. useState
  // giữ y một mảng suốt đời component và không phải là ref → đọc thoải mái. useMemo cũng đọc
  // được nhưng React được phép bỏ cache, lúc đó ref đổi và đường nối trỏ vào node đã tháo.
  const [targetRefs] = useState(() =>
    AGENT_ROUTING.targets.map(() => createRef<HTMLDivElement>()),
  );

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-6 shadow-card">
      <p className="mono-label text-muted">
        {AGENT_ROUTING.label} · {AGENT_ROUTING.targets.length + 1} agent+
      </p>

      <div
        ref={containerRef}
        className="relative mt-6 flex items-stretch justify-between gap-2 sm:gap-6"
      >
        {/* Đường nối vẽ trước, node có `z-10` nằm trên — đầu đường bị đĩa tròn che. */}
        <AnimatedBeam
          containerRef={containerRef}
          fromRef={sourceRef}
          toRef={hubRef}
          duration={BEAM_DURATION_S}
          delay={INBOUND_DELAY_S}
        />
        {targetRefs.map((targetRef, i) => (
          <AnimatedBeam
            key={AGENT_ROUTING.targets[i]?.id}
            containerRef={containerRef}
            fromRef={hubRef}
            toRef={targetRef}
            duration={BEAM_DURATION_S}
            delay={OUTBOUND_DELAY_S + i * BEAM_STAGGER_S}
          />
        ))}

        <div className="z-10 flex flex-col justify-center">
          <div className="flex flex-col items-center gap-2">
            <NodeCircle nodeRef={sourceRef}>
              <Icon
                name={AGENT_ROUTING.source.icon as IconName}
                size={20}
                className="text-muted"
              />
            </NodeCircle>
            <div className="text-center">
              <p className="text-[11px] font-medium leading-tight text-strong sm:text-sm">
                {AGENT_ROUTING.source.label}
              </p>
              <p className="mono-label hidden text-muted sm:block">
                {AGENT_ROUTING.source.note}
              </p>
            </div>
          </div>
        </div>

        <div className="z-10 flex flex-col justify-center">
          <div className="flex flex-col items-center gap-2">
            <NodeCircle nodeRef={hubRef} size="lg">
              <LogoMark size={26} />
            </NodeCircle>
            <div className="text-center">
              <p className="text-[11px] font-medium leading-tight text-strong sm:text-sm">
                {AGENT_ROUTING.hub.label}
              </p>
              <p className="mono-label hidden text-brand-ink sm:block">
                {AGENT_ROUTING.hub.note}
              </p>
            </div>
          </div>
        </div>

        <div className="z-10 flex flex-col gap-3 sm:gap-4">
          {AGENT_ROUTING.targets.map((target, i) => (
            <div key={target.id} className="flex items-center gap-2 sm:gap-3">
              <NodeCircle nodeRef={targetRefs[i] ?? null}>
                <Icon name={target.icon as IconName} size={20} className="text-accent" />
              </NodeCircle>
              <div>
                <p className="text-[11px] font-medium leading-tight text-strong sm:text-sm">
                  {target.label}
                </p>
                <p className="mono-label hidden text-muted sm:block">{target.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 max-w-prose text-sm text-muted">{AGENT_ROUTING.caption}</p>
    </div>
  );
}
