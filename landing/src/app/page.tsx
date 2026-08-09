import { AgentSection } from "@/components/AgentSection";
import { FaqSection } from "@/components/FaqSection";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ProblemSection } from "@/components/ProblemSection";

export default function Home() {
  return (
    <>
      {/* Người dùng bàn phím không phải Tab qua header mỗi lần vào trang.
          Ẩn cho tới khi nhận focus. */}
      <a
        href="#noi-dung"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-btn-primary-bg focus-visible:px-4 focus-visible:py-2 focus-visible:text-btn-primary-fg"
      >
        Tới nội dung chính
      </a>
      <Header />
      <main id="noi-dung" className="flex flex-1 flex-col">
        <Hero />
        <ProblemSection />
        <AgentSection />
        <FaqSection />
      </main>
      <Footer />
    </>
  );
}
