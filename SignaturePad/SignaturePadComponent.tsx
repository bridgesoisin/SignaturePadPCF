import * as React from "react";

interface Props {
    value: string;
    onChange: (value: string) => void;
    width: number;
    height: number;
}

const SignaturePadComponent: React.FC<Props> = ({ value, onChange, width, height }) => {

    React.useEffect(() => {
        // --- YOUR CONFIG & STATE ---
        const G = 30;        // px per grid cell (200mm each)
        const MM = 200;      // mm per grid cell

        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        if (!canvas) return;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

        let tab = 'before';
        const scenes = {
            before: { walls: [] as any[], fixtures: [] as any[] },
            after: { walls: [] as any[], fixtures: [] as any[] },
        };
        let tool = 'select';
        let wallPts: any[] = [];   
        let ghostPt: any = null; 
        let placing: any = null; 
        let selIdx: number | null = null; 
        let iact: any = null; 

        const DEFS: Record<string, any> = {
            toilet: { w: 1.8, h: 3.5, label: 'Toilet', color: '#f0efe8', stroke: '#8a8a8a' },
            sink: { w: 2.5, h: 2.0, label: 'Sink', color: '#dceef8', stroke: '#7ab0cc' },
            bath: { w: 8.5, h: 3.5, label: 'Bath', color: '#c8dff5', stroke: '#6a9cc0' },
            shower: { w: 4.5, h: 4.5, label: 'Shower Tray', color: '#d4f0ff', stroke: '#70bbd4' },
            vanity: { w: 3.0, h: 2.5, label: 'Vanity', color: '#f0e8d8', stroke: '#b09070' },
            door: { w: 4.0, h: 0.5, label: 'Door', color: '#f8e8a8', stroke: '#c8a830' },
            window: { w: 5.0, h: 0.5, label: 'Window', color: '#b8e8ff', stroke: '#5090b8' },
            soilstack: { w: 0.8, h: 0.8, label: 'Soil Stack', color: '#b8b0a0', stroke: '#706860' },
            light: { w: 1.0, h: 1.0, label: 'Light', color: '#fffcb8', stroke: '#c8c050' },
        };

        // --- RESIZE LOGIC ---
        function resizeCanvas() {
            const wrap = document.getElementById('canvas-wrap');
            if (!wrap) return;
            const w = wrap.clientWidth - 48;
            const h = wrap.clientHeight - 48;
            canvas.width = Math.max(600, w);
            canvas.height = Math.max(400, h);
            render();
        }
        window.addEventListener('resize', resizeCanvas);

        // --- CORE FUNCTIONS ---
        function switchTab(t: string) {
            if (t === 'after' && scenes.after.walls.length === 0 && scenes.before.walls.length > 0) {
                scenes.after.walls = scenes.before.walls.map((p: any) => ({ ...p }));
            }
            tab = t;
            wallPts = []; ghostPt = null; placing = null; selIdx = null; iact = null;
            document.getElementById('tab-before')?.classList.toggle('active', t === 'before');
            document.getElementById('tab-after')?.classList.toggle('active', t === 'after');
            clearAllFixBtnActive();
            setTool('select');
            setStatus(t === 'after' ? 'AFTER — walls copied from BEFORE. Add new fixtures.' : 'BEFORE sketch');
            render();
        }

        function setTool(t: string) {
            tool = t; placing = null; ghostPt = null;
            clearAllFixBtnActive();
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'danger-active'));
            const b = document.getElementById('btn-' + t);
            if (b) b.classList.add(t === 'delete' ? 'danger-active' : 'active');
            canvas.style.cursor = t === 'wall' ? 'crosshair' : 'default';
            const msgs: Record<string, string> = {
                select: 'Click to select · Drag to move · Corner handles resize · Green ● rotates',
                wall: 'Tap to add wall points · Tap the blue ● to close the room',
                delete: 'Tap a fixture to delete it',
            };
            setStatus(msgs[t] || '');
            render();
        }

        function placeFixture(type: string) {
            const d = DEFS[type];
            placing = { type, w: d.w, h: d.h, rotation: 0, label: d.label, color: d.color, stroke: d.stroke, x: 2, y: 2 };
            tool = 'placing';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'danger-active'));
            clearAllFixBtnActive();
            document.getElementById('fix-' + type)?.classList.add('placing');
            canvas.style.cursor = 'crosshair';
            setStatus('Tap canvas to place ' + d.label + ' · ESC to cancel');
            render();
        }

        function clearAllFixBtnActive() { document.querySelectorAll('.fix-btn').forEach(b => b.classList.remove('placing')); }
        function setStatus(msg: string) { const el = document.getElementById('header-status'); if(el) el.textContent = msg; }
        function sc() { return scenes[tab as 'before' | 'after']; }

        function clearWalls() {
            if (!window.confirm('Clear walls from this sketch?')) return;
            sc().walls = []; wallPts = []; ghostPt = null; render();
        }
        function deleteSelected() {
            if (selIdx !== null) { sc().fixtures.splice(selIdx, 1); selIdx = null; render(); }
        }

        function cpos(e: PointerEvent) { return { x: e.offsetX, y: e.offsetY }; }
        function snapI(v: number) { return Math.round(v / G); }
        function snapH(v: number) { return Math.round(v / G * 2) / 2; }
        function gp(v: number) { return v * G; }

        // --- RENDER FUNCTIONS ---
        function render() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawGrid();
            const s = sc();
            if (s.walls.length > 0) drawWallPoly(s.walls);
            if (wallPts.length > 0) drawWallInProgress(wallPts, ghostPt);
            s.fixtures.forEach((f: any, i: number) => drawFixture(f, i === selIdx));
            if (placing) { ctx.globalAlpha = 0.5; drawFixture(placing, false); ctx.globalAlpha = 1; }
        }

        function drawGrid() {
            ctx.lineWidth = 0.5; ctx.strokeStyle = '#dde0e8';
            for (let x = 0; x <= canvas.width; x += G) ln(x, 0, x, canvas.height);
            for (let y = 0; y <= canvas.height; y += G) ln(0, y, canvas.width, y);
            ctx.lineWidth = 1; ctx.strokeStyle = '#c0c5d5';
            for (let x = 0; x <= canvas.width; x += G * 5) ln(x, 0, x, canvas.height);
            for (let y = 0; y <= canvas.height; y += G * 5) ln(0, y, canvas.width, y);
        }
        function ln(x1: number, y1: number, x2: number, y2: number) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

        function drawWallPoly(pts: any[]) {
            const n = pts.length;
            if (n > 2) {
                ctx.beginPath();
                ctx.moveTo(gp(pts[0].x), gp(pts[0].y));
                for (let i = 1; i < n; i++) ctx.lineTo(gp(pts[i].x), gp(pts[i].y));
                ctx.closePath(); ctx.fillStyle = '#f8f9fc'; ctx.fill();
            }
            ctx.save();
            ctx.strokeStyle = '#1d2230'; ctx.lineWidth = 5; ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
            ctx.beginPath();
            ctx.moveTo(gp(pts[0].x), gp(pts[0].y));
            for (let i = 1; i < n; i++) ctx.lineTo(gp(pts[i].x), gp(pts[i].y));
            ctx.closePath(); ctx.stroke(); ctx.restore();
            for (let i = 0; i < n; i++) drawMeasure(pts[i], pts[(i + 1) % n], false);
            pts.forEach((p, i) => {
                ctx.beginPath(); ctx.arc(gp(p.x), gp(p.y), i === 0 ? 8 : 5, 0, Math.PI * 2);
                ctx.fillStyle = i === 0 ? '#4f8ef7' : '#1d2230'; ctx.fill();
                if (i === 0) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); }
            });
        }

        function drawWallInProgress(pts: any[], ghost: any) {
            const n = pts.length;
            ctx.save();
            ctx.strokeStyle = '#3a4870'; ctx.lineWidth = 3; ctx.lineCap = 'square';
            ctx.setLineDash([8, 5]);
            ctx.beginPath();
            ctx.moveTo(gp(pts[0].x), gp(pts[0].y));
            for (let i = 1; i < n; i++) ctx.lineTo(gp(pts[i].x), gp(pts[i].y));
            ctx.stroke(); ctx.setLineDash([]); ctx.restore();
            for (let i = 0; i < n - 1; i++) drawMeasure(pts[i], pts[i + 1], true);
            if (ghost) {
                const last = pts[n - 1];
                ctx.save();
                ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
                ctx.beginPath(); ctx.moveTo(gp(last.x), gp(last.y)); ctx.lineTo(gp(ghost.x), gp(ghost.y));
                ctx.stroke(); ctx.setLineDash([]); ctx.restore();
                drawMeasure(last, ghost, true);
            }
            pts.forEach((p, i) => {
                ctx.beginPath(); ctx.arc(gp(p.x), gp(p.y), i === 0 ? 8 : 5, 0, Math.PI * 2);
                ctx.fillStyle = i === 0 ? '#4f8ef7' : '#3a4870'; ctx.fill();
                if (i === 0) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); }
            });
        }

        function drawMeasure(a: any, b: any, inProg: boolean) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.3) return;
            const mm = Math.round(dist * MM);
            const lbl = mm + 'mm';
            const mx = gp((a.x + b.x) / 2), my = gp((a.y + b.y) / 2);
            const segPx = dist * G;
            const nx = -(gp(b.y) - gp(a.y)) / segPx * 22;
            const ny = (gp(b.x) - gp(a.x)) / segPx * 22;
            ctx.font = '15px DM Mono,monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const tw = ctx.measureText(lbl).width + 12;
            ctx.fillStyle = inProg ? 'rgba(20,30,70,0.90)' : 'rgba(15,18,32,0.88)';
            rrect(ctx, mx + nx - tw / 2, my + ny - 13, tw, 26, 5); ctx.fill();
            ctx.fillStyle = inProg ? '#7fb0ff' : '#ffffff';
            ctx.fillText(lbl, mx + nx, my + ny);
        }

        function drawFixture(f: any, selected: boolean) {
            const pw = f.w * G, ph = f.h * G, cx = gp(f.x) + pw / 2, cy = gp(f.y) + ph / 2;
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(f.rotation || 0);
            
            // Render basic box fallback or specific drawing
            ctx.fillStyle = f.color || '#eee'; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
            ctx.strokeStyle = f.stroke || '#888'; ctx.lineWidth = 1.5; ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);

            if (selected) {
                ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]);
                ctx.strokeRect(-pw / 2 - 3, -ph / 2 - 3, pw + 6, ph + 6); ctx.setLineDash([]);
            }
            const fs = Math.max(16, Math.min(22, Math.min(pw, ph) * 0.26));
            ctx.font = `bold ${fs}px DM Mono,monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const tw = ctx.measureText(f.label).width + 12;
            ctx.fillStyle = 'rgba(10,12,28,0.85)';
            rrect(ctx, -tw / 2, -fs * 0.65, tw, fs * 1.3, 4); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.fillText(f.label, 0, 0);
            ctx.restore();
            if (selected) drawHandles(f);
        }

        const HANDLES = [
            { id: 'tl', fx: -.5, fy: -.5 }, { id: 'tm', fx: 0, fy: -.5 }, { id: 'tr', fx: .5, fy: -.5 },
            { id: 'mr', fx: .5, fy: 0 }, { id: 'br', fx: .5, fy: .5 }, { id: 'bm', fx: 0, fy: .5 },
            { id: 'bl', fx: -.5, fy: .5 }, { id: 'ml', fx: -.5, fy: 0 },
        ];
        function drawHandles(f: any) {
            const pw = f.w * G, ph = f.h * G, cx = gp(f.x) + pw / 2, cy = gp(f.y) + ph / 2;
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(f.rotation || 0);
            HANDLES.forEach(h => {
                ctx.fillStyle = 'white'; ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 1.5;
                ctx.fillRect(h.fx * pw - 6, h.fy * ph - 6, 12, 12); ctx.strokeRect(h.fx * pw - 6, h.fy * ph - 6, 12, 12);
            });
            ctx.strokeStyle = '#3ecf8e'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(0, -ph / 2); ctx.lineTo(0, -ph / 2 - 28); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, -ph / 2 - 28, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#3ecf8e'; ctx.fill(); ctx.strokeStyle = '#20a068'; ctx.lineWidth = 1; ctx.stroke();
            ctx.restore();
        }

        function toLocal(px: number, py: number, cx: number, cy: number, rot: number) {
            const dx = px - cx, dy = py - cy, c = Math.cos(-rot), s = Math.sin(-rot);
            return [dx * c - dy * s, dx * s + dy * c];
        }
        function d2(ax: number, ay: number, bx: number, by: number) { return (ax - bx) ** 2 + (ay - by) ** 2; }
        
        function hitHandle(f: any, px: number, py: number) {
            const pw = f.w * G, ph = f.h * G, cx = gp(f.x) + pw / 2, cy = gp(f.y) + ph / 2;
            const [lx, ly] = toLocal(px, py, cx, cy, f.rotation || 0);
            if (d2(lx, ly, 0, -ph / 2 - 28) < 144) return { id: 'rotate' };
            for (const h of HANDLES) if (d2(lx, ly, h.fx * pw, h.fy * ph) < 100) return h;
            return null;
        }
        function hitFixture(f: any, px: number, py: number) {
            const pw = f.w * G, ph = f.h * G, cx = gp(f.x) + pw / 2, cy = gp(f.y) + ph / 2;
            const [lx, ly] = toLocal(px, py, cx, cy, f.rotation || 0);
            return Math.abs(lx) <= pw / 2 + 4 && Math.abs(ly) <= ph / 2 + 4;
        }

        function onMove(e: PointerEvent) {
            const pos = cpos(e);
            if (tool === 'wall') {
                ghostPt = { x: snapI(pos.x), y: snapI(pos.y) };
                render(); return;
            }
            if (tool === 'placing' && placing) {
                placing.x = snapH(pos.x) - placing.w / 2;
                placing.y = snapH(pos.y) - placing.h / 2;
                render(); return;
            }
            if (!iact) {
                if (tool === 'select' && selIdx !== null) {
                    const f = sc().fixtures[selIdx];
                    const h = hitHandle(f, pos.x, pos.y);
                    canvas.style.cursor = h ? (h.id === 'rotate' ? 'grab' : 'nwse-resize') : (hitFixture(f, pos.x, pos.y) ? 'move' : 'default');
                }
                return;
            }
            const f = sc().fixtures[selIdx!]; if (!f) return;
            if (iact.mode === 'drag') {
                f.x = iact.snap0.x + (snapH(pos.x) - snapH(iact.sx));
                f.y = iact.snap0.y + (snapH(pos.y) - snapH(iact.sy));
            } else if (iact.mode === 'rotate') {
                const cx = gp(f.x) + f.w * G / 2, cy = gp(f.y) + f.h * G / 2;
                f.rotation = Math.round((Math.atan2(pos.y - cy, pos.x - cx) + Math.PI / 2) / (Math.PI / 12)) * (Math.PI / 12);
            } else if (iact.mode === 'resize') {
                doResize(f, pos);
            }
            render();
        }

        function onDown(e: PointerEvent) {
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            const pos = cpos(e);
            const scene = sc();

            if (tool === 'wall') {
                const sx = snapI(pos.x), sy = snapI(pos.y);
                if (wallPts.length > 2) {
                    const f0 = wallPts[0];
                    if (Math.abs(pos.x - gp(f0.x)) < 22 && Math.abs(pos.y - gp(f0.y)) < 22) {
                        scene.walls = [...wallPts]; wallPts = []; ghostPt = null;
                        setStatus('Room closed ✓ — select fixtures to place');
                        render(); return;
                    }
                }
                const last = wallPts[wallPts.length - 1];
                if (!last || last.x !== sx || last.y !== sy) wallPts.push({ x: sx, y: sy });
                render(); return;
            }

            if (tool === 'placing' && placing) {
                const sx = snapH(pos.x), sy = snapH(pos.y);
                scene.fixtures.push({ ...placing, x: sx - placing.w / 2, y: sy - placing.h / 2 });
                selIdx = scene.fixtures.length - 1;
                placing = null; clearAllFixBtnActive();
                setTool('select'); canvas.style.cursor = 'default';
                render(); return;
            }

            if (tool === 'select') {
                if (selIdx !== null) {
                    const f = scene.fixtures[selIdx];
                    const h = hitHandle(f, pos.x, pos.y);
                    if (h) {
                        iact = { mode: h.id === 'rotate' ? 'rotate' : 'resize', handle: h, sx: pos.x, sy: pos.y, snap0: { x: f.x, y: f.y }, snapshot: { ...f } };
                        return;
                    }
                }
                for (let i = scene.fixtures.length - 1; i >= 0; i--) {
                    if (hitFixture(scene.fixtures[i], pos.x, pos.y)) {
                        selIdx = i;
                        const f = scene.fixtures[i];
                        iact = { mode: 'drag', sx: pos.x, sy: pos.y, snap0: { x: f.x, y: f.y }, snapshot: { ...f } };
                        render(); return;
                    }
                }
                selIdx = null; render();
            }
        }

        function onUp(e: PointerEvent) { iact = null; canvas.releasePointerCapture(e.pointerId); }

        function doResize(f: any, pos: any) {
            const s = iact.snapshot, h = iact.handle;
            const dx = snapH(pos.x) - snapH(iact.sx), dy = snapH(pos.y) - snapH(iact.sy);
            if (h.id === 'tr' || h.id === 'mr' || h.id === 'br') f.w = Math.max(.5, s.w + dx);
            if (h.id === 'tl' || h.id === 'ml' || h.id === 'bl') { const nw = Math.max(.5, s.w - dx); f.x = s.x + s.w - nw; f.w = nw; }
            if (h.id === 'bl' || h.id === 'bm' || h.id === 'br') f.h = Math.max(.5, s.h + dy);
            if (h.id === 'tl' || h.id === 'tm' || h.id === 'tr') { const nh = Math.max(.5, s.h - dy); f.y = s.y + s.h - nh; f.h = nh; }
        }

        function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
            ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
            ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
            ctx.closePath();
        }

        // --- BIND EVENT LISTENERS ---
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);

        document.getElementById('tab-before')?.addEventListener('click', () => switchTab('before'));
        document.getElementById('tab-after')?.addEventListener('click', () => switchTab('after'));
        
        document.getElementById('btn-select')?.addEventListener('click', () => setTool('select'));
        document.getElementById('btn-wall')?.addEventListener('click', () => setTool('wall'));
        document.getElementById('btn-clear')?.addEventListener('click', () => clearWalls());
        document.getElementById('btn-delete')?.addEventListener('click', () => deleteSelected());

        ['toilet', 'sink', 'bath', 'shower', 'vanity', 'door', 'window', 'soilstack', 'light'].forEach(type => {
            document.getElementById('fix-' + type)?.addEventListener('click', () => placeFixture(type));
        });

        // 🟢 POWER APPS EXPORT MAGIC 🟢
        document.getElementById('btn-save-powerapps')?.addEventListener('click', () => {
            const prev = selIdx; selIdx = null; render(); // Deselect before saving
            const out = document.createElement('canvas');
            out.width = canvas.width; out.height = canvas.height;
            const oc = out.getContext('2d')!;
            oc.fillStyle = 'white'; oc.fillRect(0, 0, out.width, out.height);
            oc.drawImage(canvas, 0, 0);
            
            const dataURL = out.toDataURL('image/png');
            onChange(dataURL); // SENDS TO DATAVERSE!
            setStatus('✅ Layout Saved to Power Apps!');
            
            selIdx = prev; render(); // Restore selection
        });

        // INITIALIZE
        resizeCanvas();

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointerup', onUp);
        };
    }, []);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
                .bp-container { box-sizing: border-box; margin: 0; padding: 0; --bg:#1a1c22; --panel:#23262f; --border:#2e3140; --accent:#4f8ef7; --green:#3ecf8e; --red:#f75f5f; --amber:#f7c94f; --text:#e2e4ed; --muted:#6b7280; font-family:'DM Mono',monospace; color:var(--text); background:var(--bg); width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
                .bp-header { height:56px; background:var(--panel); border-bottom:1px solid var(--border); display:flex; align-items:center; padding:0 14px; gap:12px; flex-shrink:0; }
                .bp-logo { font-family:'Syne',sans-serif; font-size:16px; font-weight:800; color:var(--text); white-space:nowrap; }
                .bp-logo span { color:var(--accent); }
                .bp-divider { width:1px; height:28px; background:var(--border); margin:0 4px; }
                .tab-btn { padding:7px 20px; border-radius:6px; border:1.5px solid var(--border); background:transparent; color:var(--muted); font-family:'DM Mono',monospace; font-size:14px; font-weight:500; cursor:pointer; transition:all .15s; }
                .tab-btn:hover { border-color:var(--accent); color:var(--text); }
                .tab-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
                .header-status { margin-left:auto; font-size:13px; color:var(--amber); font-weight:500; white-space:nowrap; }
                .bp-layout { display:flex; flex: 1; overflow: hidden; }
                .bp-sidebar { width:176px; background:var(--panel); border-right:1px solid var(--border); display:flex; flex-direction:column; overflow-y:auto; flex-shrink:0; padding-bottom:12px; }
                .bp-sec { padding:12px 10px 5px; font-size:10px; letter-spacing:1.5px; color:var(--muted); text-transform:uppercase; font-weight:500; }
                .tool-btn { display:flex; align-items:center; gap:8px; width:calc(100% - 16px); margin:0 8px 4px; padding:9px 12px; background:transparent; border:1.5px solid transparent; border-radius:6px; color:var(--text); font-family:'DM Mono',monospace; font-size:13px; cursor:pointer; text-align:left; transition:all .12s; }
                .tool-btn:hover { background:rgba(255,255,255,.05); border-color:var(--border); }
                .tool-btn.active { background:rgba(79,142,247,.15); border-color:var(--accent); color:var(--accent); }
                .tool-btn.danger { color:var(--red); }
                .tool-btn.danger:hover { background:rgba(247,95,95,.1); border-color:var(--red); }
                .tool-btn.danger-active { background:rgba(247,95,95,.15); border-color:var(--red); color:var(--red); }
                .tool-btn .ico { font-size:15px; flex-shrink:0; }
                .fix-btn { display:flex; align-items:center; gap:8px; width:calc(100% - 16px); margin:0 8px 4px; padding:8px 12px; background:transparent; border:1.5px solid var(--border); border-radius:6px; color:var(--muted); font-family:'DM Mono',monospace; font-size:13px; cursor:pointer; text-align:left; transition:all .12s; }
                .fix-btn:hover { border-color:var(--accent); color:var(--text); background:rgba(79,142,247,.06); }
                .fix-btn.placing { border-color:var(--green); color:var(--green); background:rgba(62,207,142,.1); }
                .canvas-wrap { flex:1; overflow:auto; background:#10121a; padding:24px; display: flex; align-items: center; justify-content: center;}
                canvas { display:block; background:#f4f5f7; touch-action:none; cursor:default; }
                .bp-footer { height:52px; background:var(--panel); border-top:1px solid var(--border); display:flex; align-items:center; padding:0 14px; gap:10px; flex-shrink:0; }
                .exp-btn { padding:8px 18px; border-radius:6px; border:none; background:var(--green); color:#0a1a12; font-family:'DM Mono',monospace; font-size:13px; font-weight:500; cursor:pointer; transition:opacity .15s; }
                .exp-btn:hover { opacity:.85; }
                .save-pa-btn { padding:8px 18px; border-radius:6px; border:none; background:var(--accent); color:#fff; font-family:'DM Mono',monospace; font-size:13px; font-weight:bold; cursor:pointer; }
                .save-pa-btn:hover { background: #3b74d6; }
                .scale-note { margin-left:auto; font-size:12px; color:var(--muted); }
                .kbd-hint { font-size:12px; color:var(--muted); }
            `}</style>

            <div className="bp-container">
                <div className="bp-header">
                    <div className="bp-logo">BATH<span>PLAN</span></div>
                    <div className="bp-divider"></div>
                    <button className="tab-btn active" id="tab-before">▸ Before</button>
                    <button className="tab-btn" id="tab-after">▸ After</button>
                    <div className="header-status" id="header-status">Select Draw Walls to begin</div>
                </div>

                <div className="bp-layout">
                    <div className="bp-sidebar">
                        <div className="bp-sec">Tools</div>
                        <button className="tool-btn active" id="btn-select"><span className="ico">↖</span> Select</button>
                        <button className="tool-btn" id="btn-wall"><span className="ico">✏</span> Draw Walls</button>
                        <button className="tool-btn danger" id="btn-clear"><span className="ico">⨯</span> Clear Walls</button>
                        <button className="tool-btn danger" id="btn-delete"><span className="ico">⌫</span> Delete Sel.</button>

                        <div className="bp-sec" style={{ marginTop: '4px' }}>Fixtures</div>
                        <button className="fix-btn" id="fix-toilet"><span className="ico">▭</span> Toilet</button>
                        <button className="fix-btn" id="fix-sink"><span className="ico">◯</span> Sink</button>
                        <button className="fix-btn" id="fix-bath"><span className="ico">▬</span> Bath</button>
                        <button className="fix-btn" id="fix-shower"><span className="ico">▣</span> Shower Tray</button>
                        <button className="fix-btn" id="fix-vanity"><span className="ico">▤</span> Vanity</button>
                        <button className="fix-btn" id="fix-door"><span className="ico">⌐</span> Door</button>
                        <button className="fix-btn" id="fix-window"><span className="ico">⊟</span> Window</button>
                        <button className="fix-btn" id="fix-soilstack"><span className="ico">●</span> Soil Stack</button>
                        <button className="fix-btn" id="fix-light"><span className="ico">✦</span> Light</button>
                    </div>

                    <div className="canvas-wrap" id="canvas-wrap">
                        <canvas id="canvas"></canvas>
                    </div>
                </div>

                <div className="bp-footer">
                    <button className="save-pa-btn" id="btn-save-powerapps">☁ Save Layout to App</button>
                    <span className="kbd-hint">ESC cancel · DEL delete selected · Green ● to rotate</span>
                    <span className="scale-note">1 grid sq = 200mm</span>
                </div>
            </div>
        </div>
    );
};

export default SignaturePadComponent;