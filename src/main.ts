import { Plugin, ItemView, TFile, TFolder, getAllTags, Notice, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE, ROOT, BACKLOG, WORK, ARCHIVE, TEMPLATE, STATUSES, STATUS_STAGE, TAG_TODO, TAG_PROGRESS, TAG_DONE, TAG_ARCHIVE, TAG_STAGE, TEMPLATE_CONTENT, COLUMNS, DOW_NAMES } from './constants';


interface TrackyTask {
	file: TFile;
	status: string;
	priority: string;
	date: string;
	dow: string;
	tags: string[];
	stage: number;
	description: string;
}

// Returns the column index (0=TO DO, 1=IN PROGRESS, 2=DONE) or -1 if not a valid task.
// If status and tag disagree, the lower stage wins.
function getStage(status: string, tags: string[]): number {
	const s = STATUS_STAGE[status];
	const tagStages: number[] = [];
	for (const [tag, stage] of Object.entries(TAG_STAGE)) {
		if (tags.includes(tag)) tagStages.push(stage);
	}
	if (s === undefined || tagStages.length === 0) return -1;
	return Math.min(s, ...tagStages);
}


// Converts date "2026-11-30" to "Mon". Non-date values (e.g. an old "Mon") are shown as-is.
function toDow(value: string): string {
	const parts = value.slice(0, 10).split("-"); // "2026-12-01" -> ["2026", "12", "01"]
	if (parts.length !== 3) return value; // Not a date, return as-is

	const year = Number(parts[0]);
	const month = Number(parts[1]); // 1 to 12
	const day = Number(parts[2]);

	const date = new Date(year, month - 1, day);
	if (isNaN(date.getTime())) return value;

	return DOW_NAMES[date.getDay()] ?? value;
}

// Red when the date is overdue, today, or at most 3 days from today.
// Monday + 3 days = Thursday is red; Friday is not.
function isUrgent(value: string): boolean {
	const parts = value.slice(0, 10).split("-");
	if (parts.length !== 3) return false;

	const year = Number(parts[0]);
	const month = Number(parts[1]);
	const day = Number(parts[2]);

	const deadline = new Date(year, month - 1, day);
	if (isNaN(deadline.getTime())) return false;

	const today = new Date();
	today.setHours(0, 0, 0, 0);                    // today at midnight

	const msPerDay = 24 * 60 * 60 * 1000;
	const daysLeft = Math.round((deadline.getTime() - today.getTime()) / msPerDay);

	return daysLeft <= 3;
}


class TrackyView extends ItemView {
	plugin: TrackyPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: TrackyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return "Tracky"; }
    getIcon() { return "kanban-square"; }
    async onOpen() { this.contentEl.addClass("tracky-view"); this.render(); }

    render() {
        const el = this.contentEl;
        el.empty();
        el.createEl("h2", { text: "Tracky", cls: "tracky-title" });
		const board = el.createDiv("tracky-board");
		board.style.display = "grid";
		board.style.gridTemplateColumns = "repeat(3, minmax(240px, 1fr))";
		board.style.gap = "16px";
		board.style.alignItems = "start";
        const tasks = this.plugin.getWorkTasks();

        for (const col of COLUMNS) {
            const colEl = board.createDiv("tracky-column");
			const stage = COLUMNS.indexOf(col);
			colEl.addEventListener("dragover", (e) => { e.preventDefault(); colEl.addClass("tracky-drop"); });
			colEl.addEventListener("dragleave", (e) => {
				if (!colEl.contains(e.relatedTarget as Node)) colEl.removeClass("tracky-drop");
			});
			colEl.addEventListener("drop", async (e) => {
				e.preventDefault();
				colEl.removeClass("tracky-drop");
				const path = e.dataTransfer?.getData("text/plain");
				const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
				if (file instanceof TFile) await this.plugin.moveToColumn(file, stage);
			});
			const items = tasks.filter((t) => t.stage === COLUMNS.indexOf(col));
            const head = colEl.createDiv("tracky-column-header");
            head.createSpan({ text: col.title });
            head.createSpan({ text: String(items.length), cls: "tracky-count" });
            const list = colEl.createDiv("tracky-cards");
            for (const t of items) {
                const card = list.createDiv("tracky-card");
				card.setAttr("draggable", "true");
				card.addEventListener("dragstart", (e) => {
					e.dataTransfer?.setData("text/plain", t.file.path);
					card.addClass("tracky-dragging");
				});
				card.addEventListener("dragend", () => card.removeClass("tracky-dragging"));
                card.createDiv({ text: t.file.basename, cls: "tracky-card-title" });
				const body = card.createDiv("tracky-card-body");
				const fields = body.createDiv("tracky-card-fields");
				this.row(fields, "Priority", t.priority, "priority");
				this.row(fields, "Status", t.status, "status");
				this.row(fields, "Mandatory date", t.date, "date");
				this.row(fields, "Mandatory DOW", t.dow);
				if (t.description) {
					body.createDiv({ text: t.description, cls: "tracky-card-desc" });
				}
            }
        }
    }

	row(card: HTMLElement, label: string, value: string, kind?: "priority" | "status" | "date"): void {
		const r = card.createDiv("tracky-row");
		r.createSpan({ text: label, cls: "tracky-label" });
		const v = r.createSpan({ text: value || "—", cls: "tracky-value" });
		if (!value) return;
		if (kind === "priority" || kind === "status") {
			const key = value.toLowerCase().replace(/_/g, "-");
			v.addClass("tracky-pill", `tracky-${kind}-${key}`);
		} else if (kind === "date" && isUrgent(value)) {
			v.addClass("tracky-pill", "tracky-date-urgent");
		}
	}
}

export default class TrackyPlugin extends Plugin {

	async onload() {
		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new TrackyView(leaf, this));

		this.addRibbonIcon("kanban-square", "Open Tracky", () => this.activateView());
		this.addCommand({
			id: "open-tracky",
			name: "Open Tracky dashboard",
			callback: () => this.activateView(),
		});

		this.app.workspace.onLayoutReady(async () => {
			await this.ensureStructure();
			for (const f of [...this.filesIn(BACKLOG), ...this.filesIn(WORK)]) await this.syncDow(f);
			await this.processBacklog();
			await this.checkArchive();
			this.refreshViews();

			this.registerEvent(this.app.metadataCache.on("changed", async (file) => {
				if (file.path.startsWith(ROOT + "/")) await this.syncDow(file);
				if (file.path.startsWith(BACKLOG + "/")) await this.moveIfReady(file);
				this.refreshViews();
			}));

			this.registerEvent(this.app.vault.on("create", () => this.refreshViews()));
			this.registerEvent(this.app.vault.on("delete", () => this.refreshViews()));
			this.registerEvent(this.app.vault.on("rename", () => this.refreshViews()));

			// Archive scheduler: check every minute
			this.registerInterval(window.setInterval(() => this.checkArchive(), 60 * 1000));
		});
	}

    async activateView() {
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = this.app.workspace.getLeaf("tab"); // opens in main area like other tabs
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        this.app.workspace.revealLeaf(leaf);
    }

	refreshViews() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			if (leaf.view instanceof TrackyView) leaf.view.render();
		});
	}

    // ---------- Structure ----------
	async ensureStructure() {
		for (const p of [ROOT, BACKLOG, WORK, ARCHIVE]) {
			if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p);
		}
		if (!this.app.vault.getAbstractFileByPath(TEMPLATE)) {
			await this.app.vault.create(TEMPLATE, TEMPLATE_CONTENT);
		}
		await this.ensurePropertyTypes();
	}

    // ---------- Task parsing ----------
	readTask(file: TFile): TrackyTask | null {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) return null;
		const get = (k: string) => fm[`tracky.${k}`] ?? fm.tracky?.[k];
        const tags = (getAllTags(cache) || []).map((t) => t.toLowerCase());
		const val = (v: unknown) => (v === undefined || v === null || v === "" ? "" : String(v));
		const status = val(get("task-status"));
		return {
			file,
			status,
			priority: val(get("task-priority")),
			date: val(get("task-mandatory-date")).slice(0, 10),
			dow: val(get("task-mandatory-date")) ? toDow(val(get("task-mandatory-date"))) : val(get("task-mandatory-dow")),
			tags,
			stage: getStage(status, tags),
			description: val(get("task-description")), // change "task-description" here if you want another key
		};
    }

	filesIn(folderPath: string): TFile[] {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return [];
        // return folder.children.filter((f) => f instanceof TFile && f.extension === "md");
		return folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
    }

	getWorkTasks(): TrackyTask[] {
		return this.filesIn(WORK)
			.map((f) => this.readTask(f))
			.filter((t): t is TrackyTask => t !== null && t.stage >= 0 && !t.tags.includes(TAG_ARCHIVE))
			.filter((t): t is TrackyTask => t !== null && t.stage >= 0);
	}

    // ---------- Backlog -> Work-dir ----------
    async processBacklog() {
        for (const f of this.filesIn(BACKLOG)) await this.moveIfReady(f);
    }

	async moveIfReady(file: TFile) {
        const t = this.readTask(file);
        if (!t) return;
        const ready =
            STATUSES.includes(t.status) &&
            (t.tags.includes(TAG_TODO) || t.tags.includes(TAG_PROGRESS));
        if (ready) await this.safeMove(file, WORK);
    }

	async safeMove(file: TFile, folder: string): Promise<boolean> {
		const dest = `${folder}/${file.name}`;
		if (this.app.vault.getAbstractFileByPath(dest)) {
			new Notice(`Tracky: "${file.name}" already exists in ${folder}, not moved.`);
			return false;
		}
		await this.app.fileManager.renameFile(file, dest);
		return true;
	}

	async archiveTask(file: TFile): Promise<void> {
		if (!(await this.safeMove(file, ARCHIVE))) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			let tags: string[] = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [];
			if (!tags.some((t) => String(t).replace(/^#/, "") === "tracky-task-archive")) {
				tags.push("tracky-task-archive");
			}
			fm.tags = tags;
		});
	}

	// ---------- Archive: every Sunday 23:00 ----------
	lastScheduledArchive(now = new Date()) {
		const d = new Date(now);
		d.setHours(23, 0, 0, 0);
		d.setDate(d.getDate() - d.getDay()); // back to Sunday (getDay()==0)
		if (d > now) d.setDate(d.getDate() - 7);
		return d;
	}

	async checkArchive() {
		const scheduled = this.lastScheduledArchive();
		const data = (await this.loadData()) || {};
		if (data.lastArchive && data.lastArchive >= scheduled.getTime()) return;

		for (const f of this.filesIn(WORK)) {
			const t = this.readTask(f);
			// mtime guard: tasks finished after the scheduled run wait for the next Sunday
			if (t && t.status === "Done" && t.tags.includes(TAG_DONE) && f.stat.mtime <= scheduled.getTime()) {
				await this.archiveTask(f);
			}
		}

		data.lastArchive = scheduled.getTime();
		await this.saveData(data);
		this.refreshViews();
	}


	// This method is used only for testing the archiving when is set to 3min
	// async checkArchive() {
	// 	const now = Date.now();
	// 	const data = (await this.loadData()) || {};
	// 	const wait = data.lastArchive ? now - data.lastArchive : Infinity;
	// 	console.log("[Tracky] checkArchive tick, ms since last run:", wait);
	// 	if (wait < 3 * 60 * 1000) return;
	//
	// 	for (const f of this.filesIn(WORK)) {
	// 		const t = this.readTask(f);
	// 		console.log("[Tracky] candidate:", f.name, t?.status, t?.tags);
	// 		if (t && t.status === "Done" && t.tags.includes(TAG_DONE)) {
	// 			console.log("[Tracky] archiving", f.name);
	// 			await this.archiveTask(f);
	// 		}
	// 	}
	// 	data.lastArchive = now;
	// 	await this.saveData(data);
	// 	this.refreshViews();
	// }

	async ensurePropertyTypes(): Promise<void> {
		const path = `${this.app.vault.configDir}/types.json`;
		let json: { types?: Record<string, string> } = {};
		try {
			if (await this.app.vault.adapter.exists(path)) {
				json = JSON.parse(await this.app.vault.adapter.read(path));
			}
		} catch (e) {
			console.error("Tracky: cannot parse types.json", e);
			return; // don't overwrite a file we couldn't read
		}
		json.types = json.types || {};
		const wanted: Record<string, string> = {
			"tracky.days-planned": "number",
			"tracky.days-spent": "number",
			"tracky.task-mandatory-date": "date",
			"tracky.task-mandatory-dow": "text",
			"tracky.task-description": "text",
		};

		let changed = false;
		for (const [k, v] of Object.entries(wanted)) {
			if (json.types[k] !== v) {
				json.types[k] = v;
				changed = true;
			}
		}

		if (changed) {
			await this.app.vault.adapter.write(path, JSON.stringify(json, null, 2));
			new Notice("Tracky: property types updated. Restart Obsidian to apply them.");
		}

	}

	// Keep 'tracky.task-mandatory-dow' consistent with 'task-mandatory-date'
	async syncDow(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as Record<string, any> | undefined;

		if (!fm) return;

		const date = String(fm["tracky.task-mandatory-date"] ?? fm.tracky?.["task-mandatory-date"] ?? "");

		if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return;
		const dow = toDow(date);

		const current = String(fm["tracky.task-mandatory-dow"] ?? fm.tracky?.["task-mandatory-dow"] ?? "");
		if (current === dow) return;

		await this.app.fileManager.processFrontMatter(file, (f) => {
			if (f.tracky && typeof f.tracky === "object") f.tracky["task-mandatory-dow"] = dow;
			else f["tracky.task-mandatory-dow"] = dow;
		});
	}

	async moveToColumn(file: TFile, stage: number): Promise<void> {
		const status = ["Open", "In_Progress", "Done"][stage];
		const tag = ["tracky-task-to-do", "tracky-task-in-progress", "tracky-task-done"][stage];

		if (!status || !tag) return;

		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (fm.tracky && typeof fm.tracky === "object") fm.tracky["task-status"] = status;
			else fm["tracky.task-status"] = status;

			let tags: string[] = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [];
			tags = tags.filter((t) => !String(t).replace(/^#/, "").startsWith("tracky-task-"));
			tags.push(tag);
			fm.tags = tags;
		});
	}
};
