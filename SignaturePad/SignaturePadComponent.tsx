import * as React from "react";

// ── PROPS ─────────────────────────────────────────────────────────────────────
interface Props {
    value:      string;
    sketchName: string;
    width?:     number;
    height?:    number;
    onSave: (json: string, beforePng: string, afterPng: string) => void;
}

// ── TYPES ─────────────────────────────────────────────────────────────────────
interface Pt      { x: number; y: number; }
interface Fixture { type:string; w:number; h:number; rotation:number; label:string; color:string; stroke:string; x:number; y:number; }
interface Scene   { walls:Pt[]; fixtures:Fixture[]; }
interface Handle  { id:string; fx:number; fy:number; }

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const G  = 30;
const MM = 200;
const MAX_UNDO = 50;

const DEFS: Record<string, Omit<Fixture,'x'|'y'|'rotation'|'type'>> = {
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
    {id:'mr',fx:.5, fy:0},  {id:'br',fx:.5,fy:.5}, {id:'bm',fx:0,fy:.5},
    {id:'bl',fx:-.5,fy:.5}, {id:'ml',fx:-.5,fy:0},
];

// ── COMPONENT ─────────────────────────────────────────────────────────────────
const SignaturePadComponent: React.FC<Props> = ({ value, sketchName, onSave }) => {

    const onSaveRef     = React.useRef(onSave);
    const sketchNameRef = React.useRef(sketchName);
    React.useEffect(() => { onSaveRef.current     = onSave;     }, [onSave]);
    React.useEffect(() => { sketchNameRef.current = sketchName; }, [sketchName]);

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const wrapRef   = React.useRef<HTMLDivElement>(null);

    const [activeTab,   setActiveTab]   = React.useState<'before'|'after'>('before');
    const [activeTool,  setActiveTool]  = React.useState('select');
    const [placingType, setPlacingType] = React.useState<string|null>(null);
    const [statusMsg,   setStatusMsg]   = React.useState('Tap Draw Walls to begin');
    const [canUndo,     setCanUndo]     = React.useState(false);

    const scenesRef    = React.useRef<{before:Scene;after:Scene}>({
        before:{ walls:[], fixtures:[] },
        after: { walls:[], fixtures:[] },
    });
    const undoStackRef = React.useRef<Array<{before:Scene;after:Scene}>>([]);
    const tabRef       = React.useRef<'before'|'after'>('before');
    const toolRef      = React.useRef('select');
    const wallPtsRef   = React.useRef<Pt[]>([]);
    const ghostPtRef   = React.useRef<Pt|null>(null);
    const placingRef   = React.useRef<Fixture|null>(null);
    const selIdxRef    = React.useRef<number|null>(null);
    const iactRef      = React.useRef<any>(null);

    // FIX: stable ref wrapper so the window resize listener is never stale
    const resizeCanvasRef = React.useRef<()=>void>(()=>{});

    const sc = () => scenesRef.current[tabRef.current];
    const gp = (v:number) => v*G;
    const sI = (v:number) => Math.round(v/G);
    const sH = (v:number) => Math.round(v/G*2)/2;

    // ── UNDO ────────────────────────────────────────────────────────────
    // Push BEFORE any destructive operation to capture the pre-operation state.
    function pushUndo() {
        const clone: {before:Scene;after:Scene} = JSON.parse(JSON.stringify(scenesRef.current));
        undoStackRef.current.push(clone);
        if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
        setCanUndo(true);
    }

    function doUndo() {
        const prev = undoStackRef.current.pop();
        if (!prev) return;
        scenesRef.current = prev;
        selIdxRef.current = null;
        iactRef.current   = null;
        setCanUndo(undoStackRef.current.length > 0);
        setStatusMsg('Undo ✓');
        render();
    }

    // ── CANVAS RESIZE ────────────────────────────────────────────────────
    function resizeCanvas() {
        const canvas=canvasRef.current, wrap=wrapRef.current;
        if (!canvas||!wrap) return;
        canvas.width  = Math.max(600, wrap.clientWidth  - 48);
        canvas.height = Math.max(400, wrap.clientHeight - 48);
        render();
    }

    // ── RENDER ──────────────────────────────────────────────────────────
    function render() {
        const canvas=canvasRef.current;
        const c=canvas?.getContext('2d');
        if (!canvas||!c) return;
        c.clearRect(0,0,canvas.width,canvas.height);
        drawGrid(c,canvas);
        const s=sc();
        if (s.walls.length>0)            drawWallPoly(c, s.walls);
        if (wallPtsRef.current.length>0) drawWallInProgress(c, wallPtsRef.current, ghostPtRef.current);
        s.fixtures.forEach((f,i) => drawFixture(c, f, i===selIdxRef.current));
        if (placingRef.current) { c.globalAlpha=0.5; drawFixture(c,placingRef.current,false); c.globalAlpha=1; }
    }

    // ── GRID ────────────────────────────────────────────────────────────
    function drawGrid(c:CanvasRenderingContext2D, canvas:HTMLCanvasElement) {
        c.lineWidth=0.5; c.strokeStyle='#dde0e8';
        for(let x=0;x<=canvas.width; x+=G) seg(c,x,0,x,canvas.height);
        for(let y=0;y<=canvas.height;y+=G) seg(c,0,y,canvas.width,y);
        c.lineWidth=1; c.strokeStyle='#c0c5d5';
        for(let x=0;x<=canvas.width; x+=G*5) seg(c,x,0,x,canvas.height);
        for(let y=0;y<=canvas.height;y+=G*5) seg(c,0,y,canvas.width,y);
    }
    function seg(c:CanvasRenderingContext2D,x1:number,y1:number,x2:number,y2:number){
        c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();
    }

    // ── WALL POLYGON ────────────────────────────────────────────────────
    function drawWallPoly(c:CanvasRenderingContext2D, pts:Pt[]) {
        const n=pts.length;
        if(n>2){
            c.beginPath();c.moveTo(gp(pts[0].x),gp(pts[0].y));
            for(let i=1;i<n;i++) c.lineTo(gp(pts[i].x),gp(pts[i].y));
            c.closePath();c.fillStyle='#f8f9fc';c.fill();
        }
        c.save();
        c.strokeStyle='#1d2230';c.lineWidth=5;c.lineCap='square';c.lineJoin='miter';
        c.beginPath();c.moveTo(gp(pts[0].x),gp(pts[0].y));
        for(let i=1;i<n;i++) c.lineTo(gp(pts[i].x),gp(pts[i].y));
        c.closePath();c.stroke();c.restore();
        for(let i=0;i<n;i++) drawMeasure(c,pts[i],pts[(i+1)%n],false);
        pts.forEach((p,i)=>{
            c.beginPath();c.arc(gp(p.x),gp(p.y),i===0?8:5,0,Math.PI*2);
            c.fillStyle=i===0?'#4f8ef7':'#1d2230';c.fill();
            if(i===0){c.strokeStyle='white';c.lineWidth=2;c.stroke();}
        });
    }

    function drawWallInProgress(c:CanvasRenderingContext2D, pts:Pt[], ghost:Pt|null) {
        const n=pts.length;
        c.save();c.strokeStyle='#3a4870';c.lineWidth=3;c.lineCap='square';c.setLineDash([8,5]);
        c.beginPath();c.moveTo(gp(pts[0].x),gp(pts[0].y));
        for(let i=1;i<n;i++) c.lineTo(gp(pts[i].x),gp(pts[i].y));
        c.stroke();c.setLineDash([]);c.restore();
        for(let i=0;i<n-1;i++) drawMeasure(c,pts[i],pts[i+1],true);
        if(ghost){
            const last=pts[n-1];
            c.save();c.strokeStyle='#4f8ef7';c.lineWidth=2;c.setLineDash([5,4]);
            c.beginPath();c.moveTo(gp(last.x),gp(last.y));c.lineTo(gp(ghost.x),gp(ghost.y));
            c.stroke();c.setLineDash([]);c.restore();
            drawMeasure(c,last,ghost,true);
        }
        pts.forEach((p,i)=>{
            c.beginPath();c.arc(gp(p.x),gp(p.y),i===0?8:5,0,Math.PI*2);
            c.fillStyle=i===0?'#4f8ef7':'#3a4870';c.fill();
            if(i===0){c.strokeStyle='white';c.lineWidth=2;c.stroke();}
        });
    }

    function drawMeasure(c:CanvasRenderingContext2D, a:Pt, b:Pt, inProg:boolean) {
        const dx=b.x-a.x,dy=b.y-a.y,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<0.3) return;
        const lbl=Math.round(dist*MM)+'mm';
        const mx=gp((a.x+b.x)/2), my=gp((a.y+b.y)/2), spx=dist*G;
        const nx=-(gp(b.y)-gp(a.y))/spx*22, ny=(gp(b.x)-gp(a.x))/spx*22;
        c.font='15px DM Mono,Consolas,monospace';
        c.textAlign='center';c.textBaseline='middle';
        const tw=c.measureText(lbl).width+12;
        c.fillStyle=inProg?'rgba(20,30,70,.90)':'rgba(15,18,32,.88)';
        rrect(c,mx+nx-tw/2,my+ny-13,tw,26,5);c.fill();
        c.fillStyle=inProg?'#7fb0ff':'#ffffff';
        c.fillText(lbl,mx+nx,my+ny);
    }

    // ── FIXTURE DRAWING ──────────────────────────────────────────────────
    function drawFixture(c:CanvasRenderingContext2D, f:Fixture, selected:boolean) {
        const pw=f.w*G,ph=f.h*G,cx=gp(f.x)+pw/2,cy=gp(f.y)+ph/2;
        c.save();c.translate(cx,cy);c.rotate(f.rotation||0);
        switch(f.type){
            case 'toilet':    drawToilet(c,pw,ph,f);    break;
            case 'sink':      drawSink(c,pw,ph,f);      break;
            case 'bath':      drawBath(c,pw,ph,f);      break;
            case 'shower':    drawShower(c,pw,ph,f);    break;
            case 'vanity':    drawVanity(c,pw,ph,f);    break;
            case 'door':      drawDoor(c,pw,ph,f);      break;
            case 'window':    drawWindow(c,pw,ph,f);    break;
            case 'soilstack': drawSoilStack(c,pw,ph,f); break;
            case 'light':     drawLight(c,pw,ph,f);     break;
            default:          baseBox(c,pw,ph,f);
        }
        if(selected){
            c.strokeStyle='#4f8ef7';c.lineWidth=2.5;c.setLineDash([5,4]);
            c.strokeRect(-pw/2-3,-ph/2-3,pw+6,ph+6);c.setLineDash([]);
        }
        const fs=Math.max(16,Math.min(22,Math.min(pw,ph)*0.26));
        c.font=`bold ${fs}px DM Mono,Consolas,monospace`;
        c.textAlign='center';c.textBaseline='middle';
        const tw=c.measureText(f.label).width+12;
        c.fillStyle='rgba(10,12,28,.85)';
        rrect(c,-tw/2,-fs*.65,tw,fs*1.3,4);c.fill();
        c.fillStyle='#fff';c.fillText(f.label,0,0);
        c.restore();
        if(selected) drawHandles(c,f);
    }

    function baseBox(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        c.fillStyle=f.color;c.fillRect(-pw/2,-ph/2,pw,ph);
        c.strokeStyle=f.stroke;c.lineWidth=1.5;c.strokeRect(-pw/2,-ph/2,pw,ph);
    }
    function drawToilet(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        c.fillStyle='#dddcd5';c.fillRect(-pw*.42,-ph/2,pw*.84,ph*.28);
        c.strokeStyle='#a0a0a0';c.lineWidth=1;c.strokeRect(-pw*.42,-ph/2,pw*.84,ph*.28);
        c.beginPath();c.ellipse(0,ph*.1,pw*.36,ph*.27,0,0,Math.PI*2);
        c.fillStyle='#f8f7f0';c.fill();c.strokeStyle=f.stroke;c.lineWidth=1;c.stroke();
        c.beginPath();c.ellipse(0,ph*.1,pw*.28,ph*.20,0,0,Math.PI*2);
        c.strokeStyle='#c0bfb5';c.lineWidth=.8;c.stroke();
    }
    function drawSink(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        c.beginPath();c.ellipse(0,0,pw*.36,ph*.36,0,0,Math.PI*2);
        c.fillStyle='#eef6ff';c.fill();c.strokeStyle=f.stroke;c.lineWidth=1;c.stroke();
        c.beginPath();c.arc(0,0,2.5,0,Math.PI*2);c.fillStyle='#7090a8';c.fill();
        c.fillStyle='#b8c8d4';
        c.fillRect(-pw*.22,-ph/2+ph*.07,pw*.14,ph*.1);
        c.fillRect( pw*.08,-ph/2+ph*.07,pw*.14,ph*.1);
    }
    function drawBath(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        c.strokeStyle='#90b8d8';c.lineWidth=1;
        c.strokeRect(-pw/2+pw*.04,-ph/2+ph*.1,pw*.92,ph*.8);
        c.beginPath();c.arc(pw/2-pw*.07,0,ph*.08,0,Math.PI*2);
        c.strokeStyle='#90b8d8';c.lineWidth=.8;c.stroke();
        c.fillStyle='#b0c8d8';
        c.fillRect(pw/2-pw*.14,-ph*.14,pw*.09,ph*.1);
        c.fillRect(pw/2-pw*.14, ph*.04,pw*.09,ph*.1);
    }
    function drawShower(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        const r=Math.min(pw,ph)*.28;
        c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.strokeStyle='#80c0d8';c.lineWidth=1;c.stroke();
        for(let a=0;a<Math.PI*2;a+=Math.PI/4){
            c.beginPath();c.arc(Math.cos(a)*r*.65,Math.sin(a)*r*.65,2,0,Math.PI*2);
            c.fillStyle='#80c0d8';c.fill();
        }
        c.beginPath();c.arc(0,0,2,0,Math.PI*2);c.fillStyle='#80c0d8';c.fill();
    }
    function drawVanity(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        c.strokeStyle='#c0a078';c.lineWidth=1;
        seg(c,-pw/2+1,0,pw/2-1,0);seg(c,0,-ph/2+1,0,ph/2-1);
        c.fillStyle='#909090';
        [[-pw*.22,-ph*.25],[pw*.22,-ph*.25],[-pw*.22,ph*.25],[pw*.22,ph*.25]].forEach(([hx,hy])=>{
            c.fillRect(hx-pw*.07,hy-2,pw*.14,4);
        });
    }
    function drawDoor(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        c.beginPath();c.moveTo(-pw/2,ph/2);c.arc(-pw/2,ph/2,pw,-Math.PI/2,0);
        c.strokeStyle='#b09820';c.lineWidth=1;c.setLineDash([4,4]);c.stroke();c.setLineDash([]);
        c.beginPath();c.arc(-pw/2,ph/2,3,0,Math.PI*2);c.fillStyle='#c0a030';c.fill();
        c.beginPath();c.arc(pw/2-pw*.14,0,3,0,Math.PI*2);c.fillStyle='#c0a030';c.fill();
    }
    function drawWindow(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        baseBox(c,pw,ph,f);
        c.strokeStyle='#70a8c8';c.lineWidth=.8;c.strokeRect(-pw/2+2,-ph/2+2,pw-4,ph-4);
        c.beginPath();
        c.moveTo(-pw/4,-ph/2);c.lineTo(-pw/4,ph/2);
        c.moveTo( pw/4,-ph/2);c.lineTo( pw/4,ph/2);
        c.strokeStyle='#70a8c8';c.lineWidth=1;c.stroke();
    }
    function drawSoilStack(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        const r=Math.min(pw,ph)/2;
        c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fillStyle=f.color;c.fill();
        c.strokeStyle=f.stroke;c.lineWidth=1.5;c.stroke();
        c.beginPath();c.arc(0,0,r*.42,0,Math.PI*2);c.strokeStyle='#5a5048';c.lineWidth=1;c.stroke();
        c.beginPath();c.arc(0,0,2,0,Math.PI*2);c.fillStyle='#5a5048';c.fill();
    }
    function drawLight(c:CanvasRenderingContext2D,pw:number,ph:number,f:Fixture){
        const r=Math.min(pw,ph)/2;
        c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fillStyle=f.color;c.fill();
        c.strokeStyle=f.stroke;c.lineWidth=1.5;c.stroke();
        c.strokeStyle='rgba(180,160,0,.6)';c.lineWidth=.8;
        for(let a=0;a<Math.PI*2;a+=Math.PI/4){
            c.beginPath();
            c.moveTo(Math.cos(a)*r*.55,Math.sin(a)*r*.55);
            c.lineTo(Math.cos(a)*r*.9, Math.sin(a)*r*.9);
            c.stroke();
        }
        c.beginPath();c.arc(0,0,r*.22,0,Math.PI*2);c.fillStyle='rgba(200,180,0,.8)';c.fill();
    }

    // ── HANDLES ──────────────────────────────────────────────────────────
    function drawHandles(c:CanvasRenderingContext2D, f:Fixture) {
        const pw=f.w*G,ph=f.h*G,cx=gp(f.x)+pw/2,cy=gp(f.y)+ph/2;
        c.save();c.translate(cx,cy);c.rotate(f.rotation||0);
        HANDLES.forEach(h=>{
            c.fillStyle='white';c.strokeStyle='#4f8ef7';c.lineWidth=1.5;
            c.fillRect(h.fx*pw-6,h.fy*ph-6,12,12);c.strokeRect(h.fx*pw-6,h.fy*ph-6,12,12);
        });
        c.strokeStyle='#3ecf8e';c.lineWidth=1.5;
        c.beginPath();c.moveTo(0,-ph/2);c.lineTo(0,-ph/2-28);c.stroke();
        c.beginPath();c.arc(0,-ph/2-28,7,0,Math.PI*2);
        c.fillStyle='#3ecf8e';c.fill();c.strokeStyle='#20a068';c.lineWidth=1;c.stroke();
        c.restore();
    }

    // ── HIT TESTING ──────────────────────────────────────────────────────
    /**
     * Rotate a screen-space point into a fixture's local coordinate space.
     * Rotation matrix for angle -rot:
     *   x' =  x·cos(rot) + y·sin(rot)
     *   y' = -x·sin(rot) + y·cos(rot)
     */
    function toLocal(px:number,py:number,cx:number,cy:number,rot:number): [number,number] {
        const dx=px-cx, dy=py-cy;
        const co=Math.cos(-rot), si=Math.sin(-rot);
        return [dx*co - dy*si, dx*si + dy*co];
    }
    function d2(ax:number,ay:number,bx:number,by:number){ return (ax-bx)**2+(ay-by)**2; }

    function hitHandle(f:Fixture, px:number, py:number): Handle|{id:'rotate'}|null {
        const pw=f.w*G, ph=f.h*G, cx=gp(f.x)+pw/2, cy=gp(f.y)+ph/2;
        const [lx,ly]=toLocal(px,py,cx,cy,f.rotation||0);
        if(d2(lx,ly,0,-ph/2-28)<144) return {id:'rotate'} as any;
        for(const h of HANDLES) if(d2(lx,ly,h.fx*pw,h.fy*ph)<100) return h;
        return null;
    }
    function hitFixture(f:Fixture, px:number, py:number): boolean {
        const pw=f.w*G, ph=f.h*G, cx=gp(f.x)+pw/2, cy=gp(f.y)+ph/2;
        const [lx,ly]=toLocal(px,py,cx,cy,f.rotation||0);
        return Math.abs(lx)<=pw/2+4 && Math.abs(ly)<=ph/2+4;
    }

    // ── TOOL ACTIONS ─────────────────────────────────────────────────────
    function doSwitchTab(t:'before'|'after') {
        if(t==='after' && scenesRef.current.after.walls.length===0 && scenesRef.current.before.walls.length>0){
            scenesRef.current.after.walls = scenesRef.current.before.walls.map(p=>({...p}));
        }
        tabRef.current=t; setActiveTab(t);
        wallPtsRef.current=[]; ghostPtRef.current=null;
        placingRef.current=null; selIdxRef.current=null; iactRef.current=null;
        setPlacingType(null);
        doSetTool('select');
        setStatusMsg(t==='after'
            ? 'AFTER — walls copied from Before. Add new fixtures.'
            : 'BEFORE sketch');
        render();
    }

    function doSetTool(t:string){
        toolRef.current=t; placingRef.current=null; ghostPtRef.current=null;
        setActiveTool(t); setPlacingType(null);
        if(canvasRef.current) canvasRef.current.style.cursor=t==='wall'?'crosshair':'default';
        const msgs:Record<string,string>={
            select:'Click to select · Drag to move · Corner handles resize · Green ● rotates',
            wall:  'Tap to add wall points · Tap the blue ● to close the room',
            delete:'Tap a fixture to delete it',
        };
        setStatusMsg(msgs[t]||'');
        render();
    }

    function doPlaceFixture(type:string){
        const d=DEFS[type];
        placingRef.current={type,...d,rotation:0,x:2,y:2};
        toolRef.current='placing'; setActiveTool('placing'); setPlacingType(type);
        if(canvasRef.current) canvasRef.current.style.cursor='crosshair';
        setStatusMsg('Tap canvas to place '+d.label+' · ESC to cancel');
        render();
    }

    function doClearWalls(){
        pushUndo();
        sc().walls=[]; wallPtsRef.current=[]; ghostPtRef.current=null; render();
    }

    function doDeleteSelected(){
        if(selIdxRef.current!==null){
            pushUndo();
            sc().fixtures.splice(selIdxRef.current,1);
            selIdxRef.current=null;
            render();
        }
    }

    // ── SAVE ────────────────────────────────────────────────────────────
    function doSave(){
        const canvas=canvasRef.current; if(!canvas) return;
        const prevSel = selIdxRef.current;
        selIdxRef.current = null;

        function renderScene(sceneKey:'before'|'after'): string {
            const scene = scenesRef.current[sceneKey];
            const out   = document.createElement('canvas');
            out.width   = canvas!.width;
            out.height  = canvas!.height;
            const oc    = out.getContext('2d')!;
            oc.fillStyle='white'; oc.fillRect(0,0,out.width,out.height);
            oc.lineWidth=0.5; oc.strokeStyle='#dde0e8';
            for(let x=0;x<=out.width; x+=G){oc.beginPath();oc.moveTo(x,0);oc.lineTo(x,out.height);oc.stroke();}
            for(let y=0;y<=out.height;y+=G){oc.beginPath();oc.moveTo(0,y);oc.lineTo(out.width,y);oc.stroke();}
            oc.lineWidth=1; oc.strokeStyle='#c0c5d5';
            for(let x=0;x<=out.width; x+=G*5){oc.beginPath();oc.moveTo(x,0);oc.lineTo(x,out.height);oc.stroke();}
            for(let y=0;y<=out.height;y+=G*5){oc.beginPath();oc.moveTo(0,y);oc.lineTo(out.width,y);oc.stroke();}
            const pts=scene.walls, n=pts.length;
            if(n>0){
                if(n>2){
                    oc.beginPath();oc.moveTo(pts[0].x*G,pts[0].y*G);
                    for(let i=1;i<n;i++) oc.lineTo(pts[i].x*G,pts[i].y*G);
                    oc.closePath();oc.fillStyle='#f8f9fc';oc.fill();
                }
                oc.save();oc.strokeStyle='#1d2230';oc.lineWidth=5;oc.lineCap='square';oc.lineJoin='miter';
                oc.beginPath();oc.moveTo(pts[0].x*G,pts[0].y*G);
                for(let i=1;i<n;i++) oc.lineTo(pts[i].x*G,pts[i].y*G);
                oc.closePath();oc.stroke();oc.restore();
                for(let i=0;i<n;i++){
                    const a=pts[i],b=pts[(i+1)%n];
                    const dx=b.x-a.x,dy=b.y-a.y,dist=Math.sqrt(dx*dx+dy*dy);
                    if(dist<0.3) continue;
                    const lbl=Math.round(dist*MM)+'mm';
                    const mx=(a.x+b.x)/2*G, my=(a.y+b.y)/2*G, spx=dist*G;
                    const nx=-(b.y-a.y)*G/spx*22, ny=(b.x-a.x)*G/spx*22;
                    oc.font='15px DM Mono,Consolas,monospace';
                    oc.textAlign='center';oc.textBaseline='middle';
                    const tw=oc.measureText(lbl).width+12;
                    oc.fillStyle='rgba(15,18,32,.88)';
                    rrect(oc,mx+nx-tw/2,my+ny-13,tw,26,5);oc.fill();
                    oc.fillStyle='#fff';oc.fillText(lbl,mx+nx,my+ny);
                }
            }
            scene.fixtures.forEach((f:Fixture)=>{
                const pw=f.w*G,ph=f.h*G,fcx=f.x*G+pw/2,fcy=f.y*G+ph/2;
                oc.save();oc.translate(fcx,fcy);oc.rotate(f.rotation||0);
                oc.fillStyle=f.color;oc.fillRect(-pw/2,-ph/2,pw,ph);
                oc.strokeStyle=f.stroke;oc.lineWidth=1.5;oc.strokeRect(-pw/2,-ph/2,pw,ph);
                const fs=Math.max(13,Math.min(18,Math.min(pw,ph)*0.22));
                oc.font=`bold ${fs}px DM Mono,Consolas,monospace`;
                oc.textAlign='center';oc.textBaseline='middle';
                const tw=oc.measureText(f.label).width+10;
                oc.fillStyle='rgba(10,12,28,.82)';
                oc.fillRect(-tw/2,-fs*.65,tw,fs*1.3);
                oc.fillStyle='#fff';oc.fillText(f.label,0,0);
                oc.restore();
            });
            oc.font='bold 11px Consolas,monospace';
            oc.fillStyle='rgba(100,110,130,.5)';oc.textAlign='right';
            oc.fillText(
                (sketchNameRef.current||'BathPlan')+' · '+sceneKey.toUpperCase()+' · 1 sq=200mm',
                out.width-8, out.height-8
            );
            return out.toDataURL('image/png');
        }

        const beforePng = renderScene('before');
        const afterPng  = renderScene('after');
        const json = JSON.stringify({
            version:2, savedAt:new Date().toISOString(),
            sketchName:sketchNameRef.current, scale:'1 grid cell = 200mm',
            scenes:scenesRef.current,
        });
        onSaveRef.current(json, beforePng, afterPng);
        setStatusMsg('✅ Saved — '+(sketchNameRef.current||'sketch'));
        selIdxRef.current=prevSel;
        render();
    }

    // ── POINTER EVENTS ───────────────────────────────────────────────────
    function onMove(e:PointerEvent){
        const pos={x:e.offsetX,y:e.offsetY};
        const tool=toolRef.current;

        if(tool==='wall'){
            ghostPtRef.current={x:sI(pos.x),y:sI(pos.y)};
            const pts=wallPtsRef.current;
            if(pts.length>0){
                const last=pts[pts.length-1];
                const dx=sI(pos.x)-last.x, dy=sI(pos.y)-last.y;
                const mm=Math.round(Math.sqrt(dx*dx+dy*dy)*MM);
                if(mm>0) setStatusMsg('Drawing … '+mm+'mm · Tap blue ● to close room');
            }
            render(); return;
        }
        if(tool==='placing'&&placingRef.current){
            placingRef.current.x=sH(pos.x)-placingRef.current.w/2;
            placingRef.current.y=sH(pos.y)-placingRef.current.h/2;
            render(); return;
        }
        if(!iactRef.current){
            if(tool==='select'&&selIdxRef.current!==null){
                const f=sc().fixtures[selIdxRef.current];
                if(f&&canvasRef.current){
                    const h=hitHandle(f,pos.x,pos.y);
                    canvasRef.current.style.cursor=h
                        ?(h.id==='rotate'?'grab':'nwse-resize')
                        :(hitFixture(f,pos.x,pos.y)?'move':'default');
                }
            }
            return;
        }

        const f=sc().fixtures[selIdxRef.current!]; if(!f) return;
        if(iactRef.current.mode==='drag'){
            f.x=iactRef.current.snap0.x+(sH(pos.x)-sH(iactRef.current.sx));
            f.y=iactRef.current.snap0.y+(sH(pos.y)-sH(iactRef.current.sy));
        } else if(iactRef.current.mode==='rotate'){
            const cx=gp(f.x)+f.w*G/2, cy=gp(f.y)+f.h*G/2;
            f.rotation=Math.round(
                (Math.atan2(pos.y-cy,pos.x-cx)+Math.PI/2)/(Math.PI/12)
            )*(Math.PI/12);
        } else if(iactRef.current.mode==='resize'){
            doResize(f, pos);
        }
        render();
    }

    function onDown(e:PointerEvent){
        e.preventDefault();
        const canvas=canvasRef.current; if(!canvas) return;
        canvas.setPointerCapture(e.pointerId);
        const pos={x:e.offsetX,y:e.offsetY};
        const tool=toolRef.current;
        const scene=sc();

        if(tool==='wall'){
            const sx=sI(pos.x),sy=sI(pos.y);
            const pts=wallPtsRef.current;
            if(pts.length>2){
                const f0=pts[0];
                if(Math.abs(pos.x-gp(f0.x))<22&&Math.abs(pos.y-gp(f0.y))<22){
                    pushUndo();
                    scene.walls=[...pts]; wallPtsRef.current=[]; ghostPtRef.current=null;
                    setStatusMsg('Room closed ✓ — select fixtures to place');
                    render(); return;
                }
            }
            const last=pts[pts.length-1];
            if(!last||last.x!==sx||last.y!==sy) wallPtsRef.current.push({x:sx,y:sy});
            render(); return;
        }

        if(tool==='placing'&&placingRef.current){
            const sx=sH(pos.x), sy=sH(pos.y);
            pushUndo();
            scene.fixtures.push({...placingRef.current,x:sx-placingRef.current.w/2,y:sy-placingRef.current.h/2});
            selIdxRef.current=scene.fixtures.length-1;
            placingRef.current=null; setPlacingType(null);
            doSetTool('select'); canvas.style.cursor='default';
            render(); return;
        }

        if(tool==='select'){
            if(selIdxRef.current!==null){
                const f=scene.fixtures[selIdxRef.current];
                if(f){
                    const h=hitHandle(f,pos.x,pos.y);
                    if(h){
                        // Capture state BEFORE the operation so Ctrl+Z restores pre-op
                        pushUndo();
                        iactRef.current={
                            mode:     h.id==='rotate' ? 'rotate' : 'resize',
                            handle:   h,
                            sx:       pos.x,
                            sy:       pos.y,
                            snap0:    {x:f.x, y:f.y},
                            snapshot: {...f},
                        };
                        return;
                    }
                }
            }
            for(let i=scene.fixtures.length-1;i>=0;i--){
                if(hitFixture(scene.fixtures[i],pos.x,pos.y)){
                    selIdxRef.current=i;
                    const f=scene.fixtures[i];
                    pushUndo();
                    iactRef.current={
                        mode:'drag', sx:pos.x, sy:pos.y,
                        snap0:{x:f.x,y:f.y}, snapshot:{...f},
                    };
                    render(); return;
                }
            }
            selIdxRef.current=null; render();
        }

        if(tool==='delete'){
            for(let i=scene.fixtures.length-1;i>=0;i--){
                if(hitFixture(scene.fixtures[i],pos.x,pos.y)){
                    pushUndo();
                    scene.fixtures.splice(i,1);
                    if(selIdxRef.current===i) selIdxRef.current=null;
                    else if(selIdxRef.current!==null&&selIdxRef.current>i) selIdxRef.current--;
                    render(); return;
                }
            }
        }
    }

    function onUp(e:PointerEvent){
        iactRef.current=null;
        canvasRef.current?.releasePointerCapture(e.pointerId);
    }

    // ── RESIZE (rotation-aware) ───────────────────────────────────────────
    //
    // ROOT CAUSE OF ORIGINAL BUG:
    //   The old code computed dx = sH(pos.x) - sH(iact.sx) entirely in screen
    //   space and applied it directly to f.w / f.h. When a fixture is rotated,
    //   its local X and Y axes no longer align with screen X and Y, so dragging
    //   "right" in screen space grew/shrank the wrong dimension.
    //
    // FIX — three steps:
    //
    //   1. MOUSE TO LOCAL SPACE
    //      Transform the current mouse position into the fixture's local coordinate
    //      system (origin at the fixture centre, axes aligned with the fixture).
    //      `toLocal` does an inverse rotation by -f.rotation.
    //
    //   2. NEW DIMENSIONS FROM LOCAL HANDLE POSITION
    //      In local space the handle for 'mr' (right-middle) is at (pw/2, 0).
    //      If the mouse is at local x = lx, the new half-width is lx, so nw = lx*2/G.
    //      For left handles (negative fx) the logic is mirrored.
    //      Handles with fx=0 (tm, bm) don't change width; fy=0 (ml, mr) don't change height.
    //
    //   3. ANCHOR POINT — keep the opposite corner fixed in world space
    //      For 'mr', the anchor is the left-edge midpoint.
    //      We compute its world position from the OLD geometry, then derive the
    //      NEW fixture centre such that world position is unchanged, then update f.x/f.y.
    //      This prevents the fixture from jumping when f.w or f.h changes.
    //
    function doResize(f:Fixture, pos:{x:number;y:number}){
        const s   = iactRef.current.snapshot as Fixture;
        const h   = iactRef.current.handle   as Handle;
        const rot = s.rotation || 0;

        // Step 1 — mouse in fixture local space (px, relative to old centre)
        const ocx = (s.x + s.w/2) * G;
        const ocy = (s.y + s.h/2) * G;
        const [lx, ly] = toLocal(pos.x, pos.y, ocx, ocy, rot);

        // Step 2 — new dimensions
        // h.fx = ±0.5 means this handle lies on the right (+) or left (-) edge.
        // h.fx = 0    means this handle is a top/bottom midpoint — width stays.
        let nw = s.w, nh = s.h;
        if(h.fx !== 0) nw = Math.max(0.5, (h.fx > 0 ?  lx : -lx) * 2 / G);
        if(h.fy !== 0) nh = Math.max(0.5, (h.fy > 0 ?  ly : -ly) * 2 / G);

        // Step 3 — anchor point (opposite corner/edge stays fixed in world space)
        const co = Math.cos(rot), si = Math.sin(rot);

        // Anchor in fixture local space before resize (px from old centre)
        const alx = -h.fx * s.w * G;
        const aly = -h.fy * s.h * G;
        // Anchor in world space
        const awx = ocx + alx*co - aly*si;
        const awy = ocy + alx*si + aly*co;

        // New anchor local position after resize
        const nalx = -h.fx * nw * G;
        const naly = -h.fy * nh * G;
        // New fixture centre = anchor_world − rotate(new_anchor_local)
        const ncx = awx - (nalx*co - naly*si);
        const ncy = awy - (nalx*si + naly*co);

        f.w = nw;
        f.h = nh;
        f.x = ncx/G - nw/2;
        f.y = ncy/G - nh/2;
    }

    // ── UTIL ─────────────────────────────────────────────────────────────
    function rrect(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
        c.beginPath();
        c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arcTo(x+w,y,x+w,y+r,r);
        c.lineTo(x+w,y+h-r);c.arcTo(x+w,y+h,x+w-r,y+h,r);
        c.lineTo(x+r,y+h);c.arcTo(x,y+h,x,y+h-r,r);
        c.lineTo(x,y+r);c.arcTo(x,y,x+r,y,r);
        c.closePath();
    }

    // ── MOUNT ────────────────────────────────────────────────────────────
    React.useEffect(()=>{
        const canvas=canvasRef.current; if(!canvas) return;

        if(value){
            try{
                const saved=JSON.parse(value);
                if(saved.scenes) scenesRef.current=saved.scenes;
            }catch{/* ignore */}
        }

        const _mv=(e:Event)=>onMove(e as PointerEvent);
        const _dn=(e:Event)=>onDown(e as PointerEvent);
        const _up=(e:Event)=>onUp(e as PointerEvent);
        const _cancel=(e:Event)=>{
            iactRef.current=null;
            canvasRef.current?.releasePointerCapture((e as PointerEvent).pointerId);
            render();
        };
        canvas.addEventListener('pointermove',_mv);
        canvas.addEventListener('pointerdown',_dn);
        canvas.addEventListener('pointerup',  _up);
        canvas.addEventListener('pointercancel',_cancel);

        const _key=(e:Event)=>{
            const ke=e as KeyboardEvent;
            if((ke.ctrlKey||ke.metaKey)&&ke.key==='z'){ ke.preventDefault(); doUndo(); return; }
            if(ke.key==='Delete'||ke.key==='Backspace'){ ke.preventDefault(); doDeleteSelected(); }
            if(ke.key==='Escape'){
                if(toolRef.current==='placing'){placingRef.current=null;setPlacingType(null);doSetTool('select');}
                else if(wallPtsRef.current.length){wallPtsRef.current=[];ghostPtRef.current=null;render();}
                else{selIdxRef.current=null;render();}
            }
        };
        document.addEventListener('keydown',_key);

        // FIX: use a ref wrapper so the window listener always calls the
        // current resizeCanvas, not the stale closure from mount time.
        resizeCanvasRef.current = resizeCanvas;
        const _resize=()=>resizeCanvasRef.current();
        window.addEventListener('resize',_resize);

        resizeCanvas();

        return ()=>{
            canvas.removeEventListener('pointermove',_mv);
            canvas.removeEventListener('pointerdown',_dn);
            canvas.removeEventListener('pointerup',  _up);
            canvas.removeEventListener('pointercancel',_cancel);
            document.removeEventListener('keydown',_key);
            window.removeEventListener('resize',_resize);
            
        };
    },[]);

    // ── JSX ──────────────────────────────────────────────────────────────
    const isTool=(t:string)=>activeTool===t;

    return (
        <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <style>{`
                .bpc{--bg:#1a1c22;--panel:#23262f;--border:#2e3140;--accent:#4f8ef7;--green:#3ecf8e;--red:#f75f5f;--amber:#f7c94f;--text:#e2e4ed;--muted:#6b7280;font-family:'DM Mono',Consolas,'Courier New',monospace;color:var(--text);background:var(--bg);width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;}
                .bpc-hdr{height:52px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;}
                .bpc-logo{display:flex;flex-direction:column;align-items:center;line-height:1;font-weight:800;white-space:nowrap;letter-spacing:-0.5px;}
                .bpc-logo span{color:var(--accent);}
                .bpc-div{width:1px;height:24px;background:var(--border);}
                .bpc-tab{padding:6px 16px;border-radius:6px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;}
                .bpc-tab:hover{border-color:var(--accent);color:var(--text);}
                .bpc-tab.on{background:var(--accent);border-color:var(--accent);color:#fff;}
                .bpc-skname{font-size:12px;font-weight:600;color:var(--amber);padding:3px 10px;border-radius:4px;background:rgba(247,201,79,.1);border:1px solid rgba(247,201,79,.3);white-space:nowrap;}
                .bpc-status{margin-left:auto;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;}
                .bpc-body{display:flex;flex:1;overflow:hidden;}
                .bpc-side{width:162px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0;padding-bottom:12px;}
                .bpc-sec{padding:10px 10px 4px;font-size:9px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;font-weight:500;}
                .bpc-tb{display:flex;align-items:center;gap:7px;width:calc(100% - 14px);margin:0 7px 3px;padding:8px 10px;background:transparent;border:1.5px solid transparent;border-radius:6px;color:var(--text);font-family:inherit;font-size:12px;cursor:pointer;text-align:left;transition:all .12s;}
                .bpc-tb:hover{background:rgba(255,255,255,.05);border-color:var(--border);}
                .bpc-tb.on{background:rgba(79,142,247,.15);border-color:var(--accent);color:var(--accent);}
                .bpc-tb.red{color:var(--red);}
                .bpc-tb.red:hover{background:rgba(247,95,95,.1);border-color:var(--red);}
                .bpc-tb.redon{background:rgba(247,95,95,.15);border-color:var(--red);color:var(--red);}
                .bpc-tb:disabled{opacity:.35;cursor:not-allowed;pointer-events:none;}
                .bpc-fb{display:flex;align-items:center;gap:7px;width:calc(100% - 14px);margin:0 7px 3px;padding:7px 10px;background:transparent;border:1.5px solid var(--border);border-radius:6px;color:var(--muted);font-family:inherit;font-size:12px;cursor:pointer;text-align:left;transition:all .12s;}
                .bpc-fb:hover{border-color:var(--accent);color:var(--text);background:rgba(79,142,247,.06);}
                .bpc-fb.pl{border-color:var(--green);color:var(--green);background:rgba(62,207,142,.1);}
                .bpc-wrap{flex:1;overflow:auto;background:#10121a;padding:24px;}
                .bpc-canvas{display:block;background:#f4f5f7;touch-action:none;}
                .bpc-ftr{height:48px;background:var(--panel);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;}
                .bpc-save{padding:7px 20px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;}
                .bpc-save:hover{opacity:.85;}
                .bpc-hint{font-size:11px;color:var(--muted);}
                .bpc-scale{margin-left:auto;font-size:11px;color:var(--muted);}
                .bpc-ico{font-size:13px;flex-shrink:0;}
            `}</style>

            <div className="bpc">
                {/* HEADER */}
                <div className="bpc-hdr">
                    <div className="bpc-logo">
                        <span style={{ fontSize: '14px', color: '#ffffff' }}>CLASSIC</span>
                        <span style={{ fontSize: '14px', color: 'var(--accent)' }}>BATHROOMS</span>
                    </div>
                    {sketchName && <div className="bpc-skname">{sketchName}</div>}
                    <div className="bpc-div"/>
                    <button className={`bpc-tab${activeTab==='before'?' on':''}`} onClick={()=>doSwitchTab('before')}>▸ Before</button>
                    <button className={`bpc-tab${activeTab==='after'?' on':''}`}  onClick={()=>doSwitchTab('after')}>▸ After</button>
                    <div className="bpc-status">{statusMsg}</div>
                </div>

                <div className="bpc-body">
                    {/* SIDEBAR */}
                    <div className="bpc-side">
                        <div className="bpc-sec">Tools</div>
                        <button className={`bpc-tb${isTool('select')?' on':''}`}        onClick={()=>doSetTool('select')}><span className="bpc-ico">↖</span>Select</button>
                        <button className={`bpc-tb${isTool('wall')?' on':''}`}          onClick={()=>doSetTool('wall')}>  <span className="bpc-ico">✏</span>Draw Walls</button>
                        <button className="bpc-tb red"                                  onClick={doClearWalls}>           <span className="bpc-ico">⨯</span>Clear Walls</button>
                        <button className={`bpc-tb red${isTool('delete')?' redon':''}`} onClick={()=>doSetTool('delete')}><span className="bpc-ico">⌫</span>Delete</button>
                        <button className="bpc-tb" disabled={!canUndo}                  onClick={doUndo}>                 <span className="bpc-ico">↩</span>Undo</button>

                        <div className="bpc-sec" style={{marginTop:4}}>Fixtures</div>
                        {(['toilet','sink','bath','shower','vanity','door','window','soilstack','light'] as const).map(type=>(
                            <button key={type} className={`bpc-fb${placingType===type?' pl':''}`} onClick={()=>doPlaceFixture(type)}>
                                <span className="bpc-ico">{({toilet:'▭',sink:'◯',bath:'▬',shower:'▣',vanity:'▤',door:'⌐',window:'⊟',soilstack:'●',light:'✦'} as Record<string,string>)[type]}</span>
                                {DEFS[type].label}
                            </button>
                        ))}
                    </div>

                    {/* CANVAS */}
                    <div className="bpc-wrap" ref={wrapRef}>
                        <canvas className="bpc-canvas" ref={canvasRef}/>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="bpc-ftr">
                    <button className="bpc-save" onClick={doSave}>☁ Save to Power Apps</button>
                    <span className="bpc-hint">Ctrl+Z undo · ESC cancel · DEL delete · Green ● rotate</span>
                    <span className="bpc-scale">1 grid sq = 200mm</span>
                </div>
            </div>
        </div>
    );
};

export default SignaturePadComponent;
