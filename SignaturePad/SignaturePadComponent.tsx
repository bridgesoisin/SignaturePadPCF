import * as React from "react";

interface Props {
    value: string;          // JSON string of saved scene (loaded on mount)
    onChange: (value: string) => void;  // called with JSON string on save
    width: number;
    height: number;
}

// ── TYPES ────────────────────────────────────────────────────────────
interface Pt       { x: number; y: number; }
interface Fixture  { type: string; w: number; h: number; rotation: number; label: string; color: string; stroke: string; x: number; y: number; }
interface Scene    { walls: Pt[]; fixtures: Fixture[]; }
interface Handle   { id: string; fx: number; fy: number; }

const G  = 30;   // px per grid cell
const MM = 200;  // mm per grid cell

const DEFS: Record<string, Omit<Fixture, 'x'|'y'|'rotation'|'type'>> = {
    toilet:    { w:1.8, h:3.5, label:'Toilet',      color:'#f0efe8', stroke:'#8a8a8a' },
    sink:      { w:2.5, h:2.0, label:'Sink',         color:'#dceef8', stroke:'#7ab0cc' },
    bath:      { w:8.5, h:3.5, label:'Bath',         color:'#c8dff5', stroke:'#6a9cc0' },
    shower:    { w:4.5, h:4.5, label:'Shower Tray',  color:'#d4f0ff', stroke:'#70bbd4' },
    vanity:    { w:3.0, h:2.5, label:'Vanity',       color:'#f0e8d8', stroke:'#b09070' },
    door:      { w:4.0, h:0.5, label:'Door',         color:'#f8e8a8', stroke:'#c8a830' },
    window:    { w:5.0, h:0.5, label:'Window',       color:'#b8e8ff', stroke:'#5090b8' },
    soilstack: { w:0.8, h:0.8, label:'Soil Stack',   color:'#b8b0a0', stroke:'#706860' },
    light:     { w:1.0, h:1.0, label:'Light',        color:'#fffcb8', stroke:'#c8c050' },
};

const HANDLES: Handle[] = [
    {id:'tl',fx:-.5,fy:-.5},{id:'tm',fx:0,fy:-.5},{id:'tr',fx:.5,fy:-.5},
    {id:'mr',fx:.5,fy:0},   {id:'br',fx:.5,fy:.5}, {id:'bm',fx:0,fy:.5},
    {id:'bl',fx:-.5,fy:.5}, {id:'ml',fx:-.5,fy:0},
];

// ── COMPONENT ────────────────────────────────────────────────────────
const SignaturePadComponent: React.FC<Props> = ({ value, onChange }) => {

    // FIX 1: useRef instead of document.getElementById — safe in React/PCF
    const canvasRef  = React.useRef<HTMLCanvasElement>(null);
    const wrapRef    = React.useRef<HTMLDivElement>(null);
    const onChangRef = React.useRef(onChange);

    // FIX 4: keep onChange ref current so save button never calls a stale closure
    React.useEffect(() => { onChangRef.current = onChange; }, [onChange]);

    // ── STATUS STATE — React-managed so re-render is correct
    const [statusMsg, setStatusMsg] = React.useState('Select Draw Walls to begin');
    const [activeTab, setActiveTab] = React.useState<'before'|'after'>('before');
    const [activeTool, setActiveTool] = React.useState('select');
    const [placingType, setPlacingType] = React.useState<string|null>(null);

    // ── MUTABLE SKETCH STATE — kept in refs (no re-render needed per draw)
    const scenesRef  = React.useRef<{before:Scene;after:Scene}>({
        before:{walls:[],fixtures:[]},
        after: {walls:[],fixtures:[]},
    });
    const tabRef     = React.useRef<'before'|'after'>('before');
    const toolRef    = React.useRef('select');
    const wallPtsRef = React.useRef<Pt[]>([]);
    const ghostPtRef = React.useRef<Pt|null>(null);
    const placingRef = React.useRef<Fixture|null>(null);
    const selIdxRef  = React.useRef<number|null>(null);
    const iactRef    = React.useRef<any>(null);

    const sc = () => scenesRef.current[tabRef.current];

    // ── CANVAS HELPERS ─────────────────────────────────────────────
    function getCtx() {
        return canvasRef.current?.getContext('2d') ?? null;
    }
    function gp(v: number) { return v * G; }
    function snapI(v: number) { return Math.round(v / G); }
    function snapH(v: number) { return Math.round(v / G * 2) / 2; }

    // ── RESIZE ─────────────────────────────────────────────────────
    function resizeCanvas() {
        const canvas = canvasRef.current;
        const wrap   = wrapRef.current;
        if (!canvas || !wrap) return;
        canvas.width  = Math.max(600, wrap.clientWidth  - 48);
        canvas.height = Math.max(400, wrap.clientHeight - 48);
        render();
    }

    // ── RENDER ─────────────────────────────────────────────────────
    function render() {
        const canvas = canvasRef.current;
        const ctx    = getCtx();
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid(ctx, canvas);
        const s = sc();
        if (s.walls.length > 0)     drawWallPoly(ctx, s.walls);
        if (wallPtsRef.current.length > 0) drawWallInProgress(ctx, wallPtsRef.current, ghostPtRef.current);
        s.fixtures.forEach((f, i) => drawFixture(ctx, f, i === selIdxRef.current));
        if (placingRef.current) {
            ctx.globalAlpha = 0.5;
            drawFixture(ctx, placingRef.current, false);
            ctx.globalAlpha = 1;
        }
    }

    function drawGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
        ctx.lineWidth = 0.5; ctx.strokeStyle = '#dde0e8';
        for (let x = 0; x <= canvas.width;  x += G) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
        for (let y = 0; y <= canvas.height; y += G) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y);  ctx.stroke(); }
        ctx.lineWidth = 1; ctx.strokeStyle = '#c0c5d5';
        for (let x = 0; x <= canvas.width;  x += G*5) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
        for (let y = 0; y <= canvas.height; y += G*5) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y);  ctx.stroke(); }
    }

    function drawWallPoly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
        const n = pts.length;
        if (n > 2) {
            ctx.beginPath();
            ctx.moveTo(gp(pts[0].x), gp(pts[0].y));
            for (let i=1;i<n;i++) ctx.lineTo(gp(pts[i].x),gp(pts[i].y));
            ctx.closePath(); ctx.fillStyle='#f8f9fc'; ctx.fill();
        }
        ctx.save();
        ctx.strokeStyle='#1d2230'; ctx.lineWidth=5; ctx.lineCap='square'; ctx.lineJoin='miter';
        ctx.beginPath();
        ctx.moveTo(gp(pts[0].x),gp(pts[0].y));
        for (let i=1;i<n;i++) ctx.lineTo(gp(pts[i].x),gp(pts[i].y));
        ctx.closePath(); ctx.stroke(); ctx.restore();
        for (let i=0;i<n;i++) drawMeasure(ctx, pts[i], pts[(i+1)%n], false);
        pts.forEach((p,i) => {
            ctx.beginPath(); ctx.arc(gp(p.x),gp(p.y),i===0?8:5,0,Math.PI*2);
            ctx.fillStyle = i===0?'#4f8ef7':'#1d2230'; ctx.fill();
            if(i===0){ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();}
        });
    }

    function drawWallInProgress(ctx: CanvasRenderingContext2D, pts: Pt[], ghost: Pt|null) {
        const n = pts.length;
        ctx.save();
        ctx.strokeStyle='#3a4870'; ctx.lineWidth=3; ctx.lineCap='square'; ctx.setLineDash([8,5]);
        ctx.beginPath(); ctx.moveTo(gp(pts[0].x),gp(pts[0].y));
        for (let i=1;i<n;i++) ctx.lineTo(gp(pts[i].x),gp(pts[i].y));
        ctx.stroke(); ctx.setLineDash([]); ctx.restore();
        for (let i=0;i<n-1;i++) drawMeasure(ctx, pts[i], pts[i+1], true);
        if (ghost) {
            const last = pts[n-1];
            ctx.save();
            ctx.strokeStyle='#4f8ef7'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
            ctx.beginPath(); ctx.moveTo(gp(last.x),gp(last.y)); ctx.lineTo(gp(ghost.x),gp(ghost.y));
            ctx.stroke(); ctx.setLineDash([]); ctx.restore();
            drawMeasure(ctx, last, ghost, true);
        }
        pts.forEach((p,i) => {
            ctx.beginPath(); ctx.arc(gp(p.x),gp(p.y),i===0?8:5,0,Math.PI*2);
            ctx.fillStyle=i===0?'#4f8ef7':'#3a4870'; ctx.fill();
            if(i===0){ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();}
        });
    }

    function drawMeasure(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, inProg: boolean) {
        const dx=b.x-a.x, dy=b.y-a.y, dist=Math.sqrt(dx*dx+dy*dy);
        if (dist<0.3) return;
        const mm   = Math.round(dist*MM);
        const lbl  = mm+'mm';
        const mx   = gp((a.x+b.x)/2), my=gp((a.y+b.y)/2);
        const segPx= dist*G;
        const nx   = -(gp(b.y)-gp(a.y))/segPx*22;
        const ny   =  (gp(b.x)-gp(a.x))/segPx*22;
        ctx.font='15px DM Mono,monospace';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        const tw=ctx.measureText(lbl).width+12;
        ctx.fillStyle=inProg?'rgba(20,30,70,0.90)':'rgba(15,18,32,0.88)';
        rrect(ctx,mx+nx-tw/2,my+ny-13,tw,26,5); ctx.fill();
        ctx.fillStyle=inProg?'#7fb0ff':'#ffffff';
        ctx.fillText(lbl,mx+nx,my+ny);
    }

    function drawFixture(ctx: CanvasRenderingContext2D, f: Fixture, selected: boolean) {
        const pw=f.w*G, ph=f.h*G, cx=gp(f.x)+pw/2, cy=gp(f.y)+ph/2;
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(f.rotation||0);
        // FIX 5: restore detailed fixture drawings
        switch(f.type) {
            case 'toilet':    drawToilet(ctx,pw,ph,f);    break;
            case 'sink':      drawSink(ctx,pw,ph,f);      break;
            case 'bath':      drawBath(ctx,pw,ph,f);      break;
            case 'shower':    drawShower(ctx,pw,ph,f);    break;
            case 'vanity':    drawVanity(ctx,pw,ph,f);    break;
            case 'door':      drawDoor(ctx,pw,ph,f);      break;
            case 'window':    drawWindow(ctx,pw,ph,f);    break;
            case 'soilstack': drawSoilStack(ctx,pw,ph,f); break;
            case 'light':     drawLight(ctx,pw,ph,f);     break;
            default:          baseBox(ctx,pw,ph,f);
        }
        if (selected) {
            ctx.strokeStyle='#4f8ef7'; ctx.lineWidth=2.5; ctx.setLineDash([5,4]);
            ctx.strokeRect(-pw/2-3,-ph/2-3,pw+6,ph+6); ctx.setLineDash([]);
        }
        const fs=Math.max(16,Math.min(22,Math.min(pw,ph)*0.26));
        ctx.font=`bold ${fs}px DM Mono,monospace`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        const tw=ctx.measureText(f.label).width+12;
        ctx.fillStyle='rgba(10,12,28,0.85)';
        rrect(ctx,-tw/2,-fs*0.65,tw,fs*1.3,4); ctx.fill();
        ctx.fillStyle='#ffffff'; ctx.fillText(f.label,0,0);
        ctx.restore();
        if (selected) drawHandles(ctx,f);
    }

    function baseBox(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        ctx.fillStyle=f.color; ctx.fillRect(-pw/2,-ph/2,pw,ph);
        ctx.strokeStyle=f.stroke; ctx.lineWidth=1.5; ctx.strokeRect(-pw/2,-ph/2,pw,ph);
    }
    function drawToilet(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        ctx.fillStyle='#dddcd5'; ctx.fillRect(-pw*.42,-ph/2,pw*.84,ph*.28);
        ctx.strokeStyle='#a0a0a0'; ctx.lineWidth=1; ctx.strokeRect(-pw*.42,-ph/2,pw*.84,ph*.28);
        ctx.beginPath(); ctx.ellipse(0,ph*.1,pw*.36,ph*.27,0,0,Math.PI*2);
        ctx.fillStyle='#f8f7f0'; ctx.fill(); ctx.strokeStyle=f.stroke; ctx.lineWidth=1; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0,ph*.1,pw*.28,ph*.20,0,0,Math.PI*2);
        ctx.strokeStyle='#c0bfb5'; ctx.lineWidth=.8; ctx.stroke();
    }
    function drawSink(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        ctx.beginPath(); ctx.ellipse(0,0,pw*.36,ph*.36,0,0,Math.PI*2);
        ctx.fillStyle='#eef6ff'; ctx.fill(); ctx.strokeStyle=f.stroke; ctx.lineWidth=1; ctx.stroke();
        ctx.beginPath(); ctx.arc(0,0,2.5,0,Math.PI*2); ctx.fillStyle='#7090a8'; ctx.fill();
        ctx.fillStyle='#b8c8d4';
        ctx.fillRect(-pw*.22,-ph/2+ph*.07,pw*.14,ph*.1);
        ctx.fillRect( pw*.08,-ph/2+ph*.07,pw*.14,ph*.1);
    }
    function drawBath(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        ctx.strokeStyle='#90b8d8'; ctx.lineWidth=1;
        ctx.strokeRect(-pw/2+pw*.04,-ph/2+ph*.1,pw*.92,ph*.8);
        ctx.beginPath(); ctx.arc(pw/2-pw*.07,0,ph*.08,0,Math.PI*2);
        ctx.strokeStyle='#90b8d8'; ctx.lineWidth=.8; ctx.stroke();
        ctx.fillStyle='#b0c8d8';
        ctx.fillRect(pw/2-pw*.14,-ph*.14,pw*.09,ph*.1);
        ctx.fillRect(pw/2-pw*.14, ph*.04,pw*.09,ph*.1);
    }
    function drawShower(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        const r=Math.min(pw,ph)*.28;
        ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.strokeStyle='#80c0d8'; ctx.lineWidth=1; ctx.stroke();
        for (let a=0;a<Math.PI*2;a+=Math.PI/4) {
            ctx.beginPath(); ctx.arc(Math.cos(a)*r*.65,Math.sin(a)*r*.65,2,0,Math.PI*2);
            ctx.fillStyle='#80c0d8'; ctx.fill();
        }
    }
    function drawVanity(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        ctx.strokeStyle='#c0a078'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(-pw/2+1,0); ctx.lineTo(pw/2-1,0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,-ph/2+1); ctx.lineTo(0,ph/2-1); ctx.stroke();
        ctx.fillStyle='#909090';
        [[-pw*.22,-ph*.25],[pw*.22,-ph*.25],[-pw*.22,ph*.25],[pw*.22,ph*.25]].forEach(([hx,hy])=>{
            ctx.fillRect(hx-pw*.07,hy-2,pw*.14,4);
        });
    }
    function drawDoor(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        ctx.beginPath(); ctx.moveTo(-pw/2,ph/2); ctx.arc(-pw/2,ph/2,pw,-Math.PI/2,0);
        ctx.strokeStyle='#b09820'; ctx.lineWidth=1; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(-pw/2,ph/2,3,0,Math.PI*2); ctx.fillStyle='#c0a030'; ctx.fill();
    }
    function drawWindow(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        baseBox(ctx,pw,ph,f);
        ctx.strokeStyle='#70a8c8'; ctx.lineWidth=.8; ctx.strokeRect(-pw/2+2,-ph/2+2,pw-4,ph-4);
        ctx.beginPath();
        ctx.moveTo(-pw/4,-ph/2); ctx.lineTo(-pw/4,ph/2);
        ctx.moveTo( pw/4,-ph/2); ctx.lineTo( pw/4,ph/2);
        ctx.strokeStyle='#70a8c8'; ctx.lineWidth=1; ctx.stroke();
    }
    function drawSoilStack(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        const r=Math.min(pw,ph)/2;
        ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle=f.color; ctx.fill();
        ctx.strokeStyle=f.stroke; ctx.lineWidth=1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(0,0,r*.42,0,Math.PI*2); ctx.strokeStyle='#5a5048'; ctx.lineWidth=1; ctx.stroke();
    }
    function drawLight(ctx: CanvasRenderingContext2D, pw: number, ph: number, f: Fixture) {
        const r=Math.min(pw,ph)/2;
        ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle=f.color; ctx.fill();
        ctx.strokeStyle=f.stroke; ctx.lineWidth=1.5; ctx.stroke();
        ctx.strokeStyle='rgba(180,160,0,.6)'; ctx.lineWidth=.8;
        for (let a=0;a<Math.PI*2;a+=Math.PI/4) {
            ctx.beginPath();
            ctx.moveTo(Math.cos(a)*r*.55,Math.sin(a)*r*.55);
            ctx.lineTo(Math.cos(a)*r*.9, Math.sin(a)*r*.9);
            ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0,0,r*.22,0,Math.PI*2); ctx.fillStyle='rgba(200,180,0,.8)'; ctx.fill();
    }

    function drawHandles(ctx: CanvasRenderingContext2D, f: Fixture) {
        const pw=f.w*G, ph=f.h*G, cx=gp(f.x)+pw/2, cy=gp(f.y)+ph/2;
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(f.rotation||0);
        HANDLES.forEach(h=>{
            ctx.fillStyle='white'; ctx.strokeStyle='#4f8ef7'; ctx.lineWidth=1.5;
            ctx.fillRect(h.fx*pw-6,h.fy*ph-6,12,12); ctx.strokeRect(h.fx*pw-6,h.fy*ph-6,12,12);
        });
        ctx.strokeStyle='#3ecf8e'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(0,-ph/2); ctx.lineTo(0,-ph/2-28); ctx.stroke();
        ctx.beginPath(); ctx.arc(0,-ph/2-28,7,0,Math.PI*2);
        ctx.fillStyle='#3ecf8e'; ctx.fill(); ctx.strokeStyle='#20a068'; ctx.lineWidth=1; ctx.stroke();
        ctx.restore();
    }

    // ── HIT TESTING ──────────────────────────────────────────────
    function toLocal(px: number, py: number, cx: number, cy: number, rot: number) {
        const dx=px-cx, dy=py-cy, c=Math.cos(-rot), s=Math.sin(-rot);
        return [dx*c-dy*s, dx*s+dy*c];
    }
    function d2(ax: number, ay: number, bx: number, by: number) { return (ax-bx)**2+(ay-by)**2; }
    function hitHandle(f: Fixture, px: number, py: number): Handle|{id:string}|null {
        const pw=f.w*G, ph=f.h*G, cx=gp(f.x)+pw/2, cy=gp(f.y)+ph/2;
        const [lx,ly]=toLocal(px,py,cx,cy,f.rotation||0);
        if (d2(lx,ly,0,-ph/2-28)<144) return {id:'rotate'};
        for (const h of HANDLES) if (d2(lx,ly,h.fx*pw,h.fy*ph)<100) return h;
        return null;
    }
    function hitFixture(f: Fixture, px: number, py: number) {
        const pw=f.w*G, ph=f.h*G, cx=gp(f.x)+pw/2, cy=gp(f.y)+ph/2;
        const [lx,ly]=toLocal(px,py,cx,cy,f.rotation||0);
        return Math.abs(lx)<=pw/2+4 && Math.abs(ly)<=ph/2+4;
    }

    // ── TOOL ACTIONS ─────────────────────────────────────────────
    function doSwitchTab(t: 'before'|'after') {
        if (t==='after' && scenesRef.current.after.walls.length===0 && scenesRef.current.before.walls.length>0) {
            scenesRef.current.after.walls = scenesRef.current.before.walls.map(p=>({...p}));
        }
        tabRef.current=t; setActiveTab(t);
        wallPtsRef.current=[]; ghostPtRef.current=null; placingRef.current=null;
        selIdxRef.current=null; iactRef.current=null;
        setPlacingType(null);
        doSetTool('select');
        setStatusMsg(t==='after'?'AFTER — walls copied. Add new fixtures.':'BEFORE sketch');
        render();
    }

    function doSetTool(t: string) {
        toolRef.current=t; placingRef.current=null; ghostPtRef.current=null;
        setActiveTool(t); setPlacingType(null);
        if (canvasRef.current) canvasRef.current.style.cursor = t==='wall'?'crosshair':'default';
        const msgs: Record<string,string>={
            select:'Click to select · Drag to move · Corner handles resize · Green ● rotates',
            wall:  'Tap to add wall points · Tap the blue ● to close the room',
            delete:'Tap a fixture to delete it',
        };
        setStatusMsg(msgs[t]||'');
        render();
    }

    function doPlaceFixture(type: string) {
        const d = DEFS[type];
        placingRef.current = {type, ...d, rotation:0, x:2, y:2};
        toolRef.current='placing'; setActiveTool('placing'); setPlacingType(type);
        if (canvasRef.current) canvasRef.current.style.cursor='crosshair';
        setStatusMsg('Tap canvas to place '+d.label+' · ESC to cancel');
        render();
    }

    function doClearWalls() {
        // FIX 2: no window.confirm — just clear directly (PCF blocks confirm dialogs)
        sc().walls=[]; wallPtsRef.current=[]; ghostPtRef.current=null; render();
    }

    function doDeleteSelected() {
        if (selIdxRef.current!==null) {
            sc().fixtures.splice(selIdxRef.current,1);
            selIdxRef.current=null; render();
        }
    }

    // FIX 3: Save outputs BOTH JSON (full data) and PNG (image)
    // JSON goes through onChange → bound to a Multiple Line Text column in Dataverse
    // PNG can be sent as a second property if you add one to the manifest
    function doSave() {
        const canvas = canvasRef.current;
        const ctx    = getCtx();
        if (!canvas || !ctx) return;

        const prev = selIdxRef.current;
        selIdxRef.current = null; render();

        // Build clean PNG
        const out = document.createElement('canvas');
        out.width=canvas.width; out.height=canvas.height;
        const oc = out.getContext('2d')!;
        oc.fillStyle='white'; oc.fillRect(0,0,out.width,out.height);
        oc.drawImage(canvas,0,0);
        const pngBase64 = out.toDataURL('image/png');

        // Build JSON payload — this is what gets stored in Dataverse Multiple Line Text
        const payload = JSON.stringify({
            version: 1,
            savedAt: new Date().toISOString(),
            scale: '1 grid cell = 200mm',
            scenes: scenesRef.current,
            pngBase64,           // embed PNG so single column stores everything
        });

        onChangRef.current(payload);  // FIX 4: use ref, never stale
        setStatusMsg('✅ Saved to Power Apps');
        selIdxRef.current=prev; render();
    }

    // ── POINTER EVENTS ────────────────────────────────────────────
    function onMove(e: PointerEvent) {
        const pos={x:e.offsetX, y:e.offsetY};
        const tool=toolRef.current;
        if (tool==='wall') {
            ghostPtRef.current={x:snapI(pos.x),y:snapI(pos.y)};
            render(); return;
        }
        if (tool==='placing' && placingRef.current) {
            placingRef.current.x=snapH(pos.x)-placingRef.current.w/2;
            placingRef.current.y=snapH(pos.y)-placingRef.current.h/2;
            render(); return;
        }
        if (!iactRef.current) {
            if (tool==='select' && selIdxRef.current!==null) {
                const f=sc().fixtures[selIdxRef.current];
                if (f) {
                    const h=hitHandle(f,pos.x,pos.y);
                    if (canvasRef.current)
                        canvasRef.current.style.cursor=h?(h.id==='rotate'?'grab':'nwse-resize'):(hitFixture(f,pos.x,pos.y)?'move':'default');
                }
            }
            return;
        }
        const f=sc().fixtures[selIdxRef.current!]; if(!f) return;
        if (iactRef.current.mode==='drag') {
            f.x=iactRef.current.snap0.x+(snapH(pos.x)-snapH(iactRef.current.sx));
            f.y=iactRef.current.snap0.y+(snapH(pos.y)-snapH(iactRef.current.sy));
        } else if (iactRef.current.mode==='rotate') {
            const cx=gp(f.x)+f.w*G/2, cy=gp(f.y)+f.h*G/2;
            f.rotation=Math.round((Math.atan2(pos.y-cy,pos.x-cx)+Math.PI/2)/(Math.PI/12))*(Math.PI/12);
        } else if (iactRef.current.mode==='resize') {
            doResize(f,pos);
        }
        render();
    }

    function onDown(e: PointerEvent) {
        e.preventDefault();
        const canvas=canvasRef.current; if(!canvas) return;
        canvas.setPointerCapture(e.pointerId);
        const pos={x:e.offsetX,y:e.offsetY};
        const tool=toolRef.current;
        const scene=sc();

        if (tool==='wall') {
            const sx=snapI(pos.x),sy=snapI(pos.y);
            const pts=wallPtsRef.current;
            if (pts.length>2) {
                const f0=pts[0];
                if (Math.abs(pos.x-gp(f0.x))<22 && Math.abs(pos.y-gp(f0.y))<22) {
                    scene.walls=[...pts]; wallPtsRef.current=[]; ghostPtRef.current=null;
                    setStatusMsg('Room closed ✓ — select fixtures to place'); render(); return;
                }
            }
            const last=pts[pts.length-1];
            if (!last||last.x!==sx||last.y!==sy) wallPtsRef.current.push({x:sx,y:sy});
            render(); return;
        }

        if (tool==='placing' && placingRef.current) {
            const sx=snapH(pos.x),sy=snapH(pos.y);
            scene.fixtures.push({...placingRef.current, x:sx-placingRef.current.w/2, y:sy-placingRef.current.h/2});
            selIdxRef.current=scene.fixtures.length-1;
            placingRef.current=null; setPlacingType(null);
            doSetTool('select'); canvas.style.cursor='default';
            render(); return;
        }

        if (tool==='select') {
            if (selIdxRef.current!==null) {
                const f=scene.fixtures[selIdxRef.current];
                if (f) {
                    const h=hitHandle(f,pos.x,pos.y);
                    if (h) {
                        iactRef.current={mode:h.id==='rotate'?'rotate':'resize',handle:h,sx:pos.x,sy:pos.y,
                            snap0:{x:f.x,y:f.y},snapshot:{...f}};
                        return;
                    }
                }
            }
            for (let i=scene.fixtures.length-1;i>=0;i--) {
                if (hitFixture(scene.fixtures[i],pos.x,pos.y)) {
                    selIdxRef.current=i;
                    const f=scene.fixtures[i];
                    iactRef.current={mode:'drag',sx:pos.x,sy:pos.y,snap0:{x:f.x,y:f.y},snapshot:{...f}};
                    render(); return;
                }
            }
            selIdxRef.current=null; render();
        }

        if (tool==='delete') {
            for (let i=scene.fixtures.length-1;i>=0;i--) {
                if (hitFixture(scene.fixtures[i],pos.x,pos.y)) {
                    scene.fixtures.splice(i,1);
                    if (selIdxRef.current===i) selIdxRef.current=null;
                    else if (selIdxRef.current!==null && selIdxRef.current>i) selIdxRef.current--;
                    render(); return;
                }
            }
        }
    }

    function onUp(e: PointerEvent) {
        iactRef.current=null;
        canvasRef.current?.releasePointerCapture(e.pointerId);
    }

    function doResize(f: Fixture, pos: {x:number;y:number}) {
        const s=iactRef.current.snapshot, h=iactRef.current.handle;
        const dx=snapH(pos.x)-snapH(iactRef.current.sx), dy=snapH(pos.y)-snapH(iactRef.current.sy);
        if (h.id==='tr'||h.id==='mr'||h.id==='br') f.w=Math.max(.5,s.w+dx);
        if (h.id==='tl'||h.id==='ml'||h.id==='bl'){const nw=Math.max(.5,s.w-dx);f.x=s.x+s.w-nw;f.w=nw;}
        if (h.id==='bl'||h.id==='bm'||h.id==='br') f.h=Math.max(.5,s.h+dy);
        if (h.id==='tl'||h.id==='tm'||h.id==='tr'){const nh=Math.max(.5,s.h-dy);f.y=s.y+s.h-nh;f.h=nh;}
    }

    // ── UTIL ─────────────────────────────────────────────────────
    function rrect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number) {
        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
        ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
        ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
        ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
        ctx.closePath();
    }

    // ── KEYBOARD ─────────────────────────────────────────────────
    function onKeyDown(e: KeyboardEvent) {
        if ((e.key==='Delete'||e.key==='Backspace') && e.target===document.body) {
            e.preventDefault(); doDeleteSelected();
        }
        if (e.key==='Escape') {
            if (toolRef.current==='placing') { placingRef.current=null; setPlacingType(null); doSetTool('select'); }
            else if (wallPtsRef.current.length) { wallPtsRef.current=[]; ghostPtRef.current=null; render(); }
            else { selIdxRef.current=null; render(); }
        }
    }

    // ── MOUNT / UNMOUNT ──────────────────────────────────────────
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // FIX 6: restore scene from value prop if it contains saved JSON
        if (value) {
            try {
                const saved = JSON.parse(value);
                if (saved.scenes) {
                    scenesRef.current = saved.scenes;
                }
            } catch { /* ignore invalid JSON */ }
        }

        // Bind canvas events (using cast because React types vs native PointerEvent)
        const _onMove = (e: Event) => onMove(e as PointerEvent);
        const _onDown = (e: Event) => onDown(e as PointerEvent);
        const _onUp   = (e: Event) => onUp(e as PointerEvent);
        canvas.addEventListener('pointermove', _onMove);
        canvas.addEventListener('pointerdown', _onDown);
        canvas.addEventListener('pointerup',   _onUp);

        const _onKey = (e: Event) => onKeyDown(e as KeyboardEvent);
        document.addEventListener('keydown', _onKey);

        const _onResize = () => resizeCanvas();
        window.addEventListener('resize', _onResize);

        resizeCanvas();

        return () => {
            canvas.removeEventListener('pointermove', _onMove);
            canvas.removeEventListener('pointerdown', _onDown);
            canvas.removeEventListener('pointerup',   _onUp);
            document.removeEventListener('keydown', _onKey);
            window.removeEventListener('resize', _onResize);
        };
      }, []); // intentionally empty — canvas logic is imperative, not reactive   

    // ── RENDER ───────────────────────────────────────────────────
    const isPlacing = (type: string) => placingType === type;
    const isTool    = (t: string)    => activeTool === t;

    return (
        <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            {/*
              FIX 7: scoped class prefix bp- throughout to avoid clashing with Power Apps CSS.
              FIX 8: no Google Fonts import — uses system monospace fallback for offline safety.
              Add DM Mono locally to your PCF assets folder if font is important.
            */}
            <style>{`
                .bp-container{box-sizing:border-box;--bg:#1a1c22;--panel:#23262f;--border:#2e3140;--accent:#4f8ef7;--green:#3ecf8e;--red:#f75f5f;--amber:#f7c94f;--text:#e2e4ed;--muted:#6b7280;font-family:'DM Mono','Consolas','Courier New',monospace;color:var(--text);background:var(--bg);width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;}
                .bp-header{height:56px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:12px;flex-shrink:0;}
                
                .bp-logo{display:flex;flex-direction:column;align-items:center;line-height:1;font-weight:800;white-space:nowrap;letter-spacing:-0.5px;}

                .bp-logo span{color:var(--accent);}
                .bp-divider{width:1px;height:28px;background:var(--border);margin:0 4px;}
                .bp-tab{padding:7px 20px;border-radius:6px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:14px;font-weight:500;cursor:pointer;transition:all .15s;}
                .bp-tab:hover{border-color:var(--accent);color:var(--text);}
                .bp-tab.bp-active{background:var(--accent);border-color:var(--accent);color:#fff;}
                .bp-status{margin-left:auto;font-size:13px;color:var(--amber);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
                .bp-layout{display:flex;flex:1;overflow:hidden;}
                .bp-sidebar{width:176px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0;padding-bottom:12px;}
                .bp-sec{padding:12px 10px 5px;font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;font-weight:500;}
                .bp-tbtn{display:flex;align-items:center;gap:8px;width:calc(100% - 16px);margin:0 8px 4px;padding:9px 12px;background:transparent;border:1.5px solid transparent;border-radius:6px;color:var(--text);font-family:inherit;font-size:13px;cursor:pointer;text-align:left;transition:all .12s;}
                .bp-tbtn:hover{background:rgba(255,255,255,.05);border-color:var(--border);}
                .bp-tbtn.bp-active{background:rgba(79,142,247,.15);border-color:var(--accent);color:var(--accent);}
                .bp-tbtn.bp-danger{color:var(--red);}
                .bp-tbtn.bp-danger:hover{background:rgba(247,95,95,.1);border-color:var(--red);}
                .bp-tbtn.bp-dactive{background:rgba(247,95,95,.15);border-color:var(--red);color:var(--red);}
                
                .bp-fbtn{display:flex;align-items:center;gap:8px;width:calc(100% - 16px);margin:0 8px 4px;padding:8px 12px;background:transparent;border:1.5px solid var(--border);border-radius:6px;color:#ffffff;font-weight:500;font-family:inherit;font-size:15px;cursor:pointer;text-align:left;transition:all .12s;}
                .bp-fbtn:hover{border-color:#6b7280;color:#b0b5c9;background:rgba(107,114,128,0.2);}
                
                .bp-fbtn.bp-placing{border-color:var(--green);color:var(--green);background:rgba(62,207,142,.1);}
                .bp-wrap{flex:1;overflow:auto;background:#10121a;padding:24px;}
                .bp-canvas{display:block;background:#f4f5f7;touch-action:none;}
                .bp-footer{height:52px;background:var(--panel);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;}
                .bp-savebtn{padding:8px 20px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;}
                .bp-savebtn:hover{opacity:.85;}
                .bp-hint{font-size:12px;color:var(--muted);}
                .bp-scale{margin-left:auto;font-size:12px;color:var(--muted);}
                .bp-ico{font-size:15px;flex-shrink:0;}
            `}</style>

            <div className="bp-container">
                <div className="bp-header">
                    
                    <div className="bp-logo">
                       <span style={{ fontSize: '14px', color: '#ffffff' }}>CLASSIC</span>
                        <span style={{ fontSize: '14px', color: 'var(--accent)' }}>BATHROOMS</span>
                    </div>
                    
                    <div className="bp-divider"/>
                    <button className={`bp-tab${activeTab==='before'?' bp-active':''}`} onClick={()=>doSwitchTab('before')}>▸ Before</button>
                    <button className={`bp-tab${activeTab==='after'?' bp-active':''}`}  onClick={()=>doSwitchTab('after')}>▸ After</button>
                    <div className="bp-status">{statusMsg}</div>
                </div>

                <div className="bp-layout">
                    <div className="bp-sidebar">
                        <div className="bp-sec">Tools</div>
                        <button className={`bp-tbtn${isTool('select')?' bp-active':''}`}    onClick={()=>doSetTool('select')}><span className="bp-ico">↖</span>Select</button>
                        <button className={`bp-tbtn${isTool('wall')?' bp-active':''}`}      onClick={()=>doSetTool('wall')}>  <span className="bp-ico">✏</span>Draw Walls</button>
                        <button className="bp-tbtn bp-danger"                               onClick={doClearWalls}>           <span className="bp-ico">⨯</span>Clear Walls</button>
                        <button className={`bp-tbtn bp-danger${isTool('delete')?' bp-dactive':''}`} onClick={()=>doSetTool('delete')}><span className="bp-ico">⌫</span>Delete Sel.</button>

                        <div className="bp-sec" style={{marginTop:4}}>Fixtures</div>
                        {(['toilet','sink','bath','shower','vanity','door','window','soilstack','light'] as const).map(type=>(
                            <button key={type} className={`bp-fbtn${isPlacing(type)?' bp-placing':''}`} onClick={()=>doPlaceFixture(type)}>
                                <span className="bp-ico">{
                                    {toilet:'▭',sink:'◯',bath:'▬',shower:'▣',vanity:'▤',door:'⌐',window:'⊟',soilstack:'●',light:'✦'}[type]
                                }</span>
                                {DEFS[type].label}
                            </button>
                        ))}
                    </div>

                    <div className="bp-wrap" ref={wrapRef}>
                        <canvas className="bp-canvas" ref={canvasRef}/>
                    </div>
                </div>

                <div className="bp-footer">
                    <button className="bp-savebtn" onClick={doSave}>☁ Save to Power Apps</button>
                    <span className="bp-hint">ESC cancel · DEL delete selected · Green ● to rotate</span>
                    <span className="bp-scale">1 grid sq = 200mm</span>
                </div>
            </div>
        </div>
    );
};

export default SignaturePadComponent;
