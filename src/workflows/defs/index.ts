// index.ts — nơi liệt kê MỌI nghiệp vụ chờ-trả-lời đang có. Thêm nghiệp vụ = thêm 1 file cùng
// thư mục + 1 dòng ở đây. Không đụng engine/poller/store, không thêm bảng, không thêm tool.
//
// Def nào cần cổng gì thì khai ở tham số của chính nó (`buildAskOriginOrderWorkflow` cần cổng tra
// chủ đơn + tra nhóm đại lý) — bộ máy workflows/ không biết mấy cổng đó tồn tại.

import type { CustomerRoomLookup } from "../../auth/types.ts";
import type { OrderOwnerPort } from "../../operational/types.ts";
import { WorkflowRegistry } from "../registry.ts";
import { buildAskOriginOrderWorkflow } from "./hoi-don-goc.ts";

/** Gộp cổng của mọi def. Def mới cần cổng mới → thêm field ở đây và cấp ở bootstrap. */
export interface WorkflowDefDeps {
  readonly owners: OrderOwnerPort;
  readonly rooms: CustomerRoomLookup;
}

export function buildWorkflowRegistry(deps: WorkflowDefDeps): WorkflowRegistry {
  return new WorkflowRegistry().register(
    buildAskOriginOrderWorkflow({ owners: deps.owners, rooms: deps.rooms }),
  );
}

export { ASK_ORIGIN_ORDER, needsOriginOrder, buildAskOriginOrderWorkflow } from "./hoi-don-goc.ts";
