import { ProviderEditor } from "../components/ProviderEditor.js";

export function ProvidersPage() {
  return (
    <section className="page page-providers">
      <header className="page-header">
        <h1>服务商与状态</h1>
        <p className="page-description">点击任意行打开抽屉编辑。健康状态每 30 秒自动探测。</p>
      </header>

      <div className="panel-list">
        <ProviderEditor showRefresh showAutoInsertRow />
      </div>
    </section>
  );
}
