// Algoritmos de layout automático do canvas.

import type { MEdge, MNode, TemplateName } from "./model";
import { childrenOf, sanitizeLog } from "./model";

// ── Layout algorithms ─────────────────────────────────────────────
export function autoLayoutOrgChart(nodes:MNode[],edges:MEdge[],rootId?:string){
  const root=rootId?nodes.find(n=>n.id===rootId):nodes[0];
  if(!root)return nodes;
  const out=[...nodes];
  const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0){out[i]={...out[i],x,y};}};
  set(root.id,500,100);
  const levels=new Map<string,number>();
  const visited=new Set<string>([root.id]);
  const queue=[root.id];levels.set(root.id,0);
  while(queue.length){
    const pid=queue.shift()!;
    const kids=childrenOf(pid,edges);
    kids.forEach((cid)=>{
      if(visited.has(cid)){ // ciclo: nao reenfileira
        console.warn(`APAMIND: ciclo em autoLayoutOrgChart no no ${sanitizeLog(cid)}`);
        return;
      }
      visited.add(cid);
      levels.set(cid,levels.get(pid)!+1);
      queue.push(cid);
    });
  }
  const byLevel=new Map<number,string[]>();
  levels.forEach((lvl,id)=>{const arr=byLevel.get(lvl);if(arr)arr.push(id);else byLevel.set(lvl,[id]);});
  byLevel.forEach((ids,lvl)=>{
    if(lvl===0)return;
    const y=100+lvl*180;
    const spread=Math.max(900,ids.length*220);
    const startX=500-spread/2+110;
    ids.forEach((id,i)=>set(id,startX+i*220,y));
  });
  return out;
}

export function autoLayoutTree(nodes:MNode[],edges:MEdge[],rootId?:string){
  const root=rootId?nodes.find(n=>n.id===rootId):nodes[0];
  if(!root)return nodes;
  const out=[...nodes];
  const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0){out[i]={...out[i],x,y};}};
  set(root.id,100,380);
  const levels=new Map<string,number>();
  const visited=new Set<string>([root.id]);
  const queue=[root.id];levels.set(root.id,0);
  while(queue.length){
    const pid=queue.shift()!;
    const kids=childrenOf(pid,edges);
    kids.forEach((cid)=>{
      if(visited.has(cid)){
        console.warn(`APAMIND: ciclo em autoLayoutTree no no ${sanitizeLog(cid)}`);
        return;
      }
      visited.add(cid);
      levels.set(cid,levels.get(pid)!+1);
      queue.push(cid);
    });
  }
  const byLevel=new Map<number,string[]>();
  levels.forEach((lvl,id)=>{const arr=byLevel.get(lvl);if(arr)arr.push(id);else byLevel.set(lvl,[id]);});
  byLevel.forEach((ids,lvl)=>{
    if(lvl===0)return;
    const x=100+lvl*250;
    const spread=Math.max(600,ids.length*120);
    const startY=380-spread/2+60;
    ids.forEach((id,i)=>set(id,x,startY+i*120));
  });
  return out;
}

export function autoLayoutFishbone(nodes:MNode[],edges:MEdge[],rootId?:string){
  const root=rootId?nodes.find(n=>n.id===rootId):nodes[0];
  if(!root)return nodes;
  const out=[...nodes];
  const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0)out[i]={...out[i],x,y};};
  set(root.id,850,380);
  const kids=childrenOf(root.id,edges);
  const topKids=kids.filter((_,i)=>i%2===0);
  const botKids=kids.filter((_,i)=>i%2===1);
  topKids.forEach((id,i)=>set(id,450,220+i*100));
  botKids.forEach((id,i)=>set(id,450,480+i*100));
  return out;
}

export function getTemplateLayout(tpl: TemplateName): "tree" | "org" | "radial" | "flow" | "fishbone" | "mindmap" | "timeline" | "grid" | "none" {
  if (tpl === "Organograma" || tpl === "Hierarquico") return "org";
  if (tpl === "Arvore" || tpl === "Arvore Direita" || tpl === "Arvore Esquerda") return "tree";
  if (tpl === "Radial") return "radial";
  if (tpl === "Fluxograma") return "flow";
  if (tpl === "Espinha de Peixe") return "fishbone";
  if (tpl === "Modelo A") return "mindmap";
  if (tpl === "Timeline") return "timeline";
  if (tpl === "Kanban") return "grid";
  return "none";
}

export function autoLayoutRadial(nodes:MNode[],edges:MEdge[],rootId?:string){
  const root=rootId?nodes.find(n=>n.id===rootId):nodes[0];
  if(!root)return nodes;
  const out=[...nodes];const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0)out[i]={...out[i],x,y};};
  set(root.id,500,380);
  const kids=childrenOf(root.id,edges);
  const r=280;
  // Guard contra divisao por zero — kids.length === 0
  if(kids.length===0)return out;
  kids.forEach((id,i)=>{const a=(i/kids.length)*Math.PI*2-Math.PI/2;set(id,500+Math.cos(a)*r,380+Math.sin(a)*r);});
  return out;
}

export function autoLayoutFlow(nodes:MNode[],edges:MEdge[]){
  const out=[...nodes];const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0)out[i]={...out[i],x,y};};
  const start=nodes.find(n=>edges.filter(e=>e.target===n.id).length===0)||nodes[0];
  if(!start)return out;
  const visited=new Set<string>();
  let x=130; const y=380;
  const walk=(id:string)=>{
    if(visited.has(id))return;
    visited.add(id);
    set(id,x,y);x+=210;
    const next=edges.find(e=>e.source===id)?.target;
    if(next)walk(next);
  };
  walk(start.id);
  // Place any orphans below
  let ox=130;
  nodes.filter(n=>!visited.has(n.id)).forEach(n=>{set(n.id,ox,600);ox+=210;});
  return out;
}

// ── Mind Map: balanced branches left and right of root ────────────
export function autoLayoutMindMap(nodes:MNode[],edges:MEdge[],rootId?:string){
  const root=rootId?nodes.find(n=>n.id===rootId):nodes[0];
  if(!root)return nodes;
  const out=[...nodes];
  const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0)out[i]={...out[i],x,y};};
  const cx=600,cy=380;
  set(root.id,cx,cy);

  // Count subtree size recursively for spacing
  // visited protege contra ciclos; reseta para cada chamada de subtreeSize
  // pois queremos o tamanho de cada subarvore de forma independente.
  function subtreeSize(id:string,visited:Set<string>=new Set<string>()):number{
    if(visited.has(id))return 0;
    visited.add(id);
    const kids=childrenOf(id,edges);
    if(kids.length===0)return 1;
    return kids.reduce((s,k)=>s+subtreeSize(k,visited),0);
  }

  const kids=childrenOf(root.id,edges);
  const right=kids.filter((_,i)=>i%2===0);
  const left=kids.filter((_,i)=>i%2!==0);

  function placeBranch(ids:string[],side:1|-1,startX:number){
    const totalH=ids.reduce((s,id)=>s+Math.max(1,subtreeSize(id))*110,0);
    let y=cy-totalH/2;
    ids.forEach(id=>{
      const sh=Math.max(1,subtreeSize(id))*110;
      const ny=y+sh/2;
      set(id,startX,ny);
      y+=sh;
      // Place children recursively
      const grandkids=childrenOf(id,edges);
      if(grandkids.length>0){
        const gx=startX+side*230;
        const gh=grandkids.length*100;
        let gy=ny-gh/2;
        grandkids.forEach(gid=>{
          set(gid,gx,gy+50);
          gy+=100;
          // Great-grandchildren
          const ggkids=childrenOf(gid,edges);
          if(ggkids.length>0){
            const ggx=gx+side*200;
            let ggy=gy-50-ggkids.length*80/2;
            ggkids.forEach(ggid=>{set(ggid,ggx,ggy+40);ggy+=80;});
          }
        });
      }
    });
  }

  placeBranch(right,1,cx+280);
  placeBranch(left,-1,cx-280);
  return out;
}

// ── Timeline: horizontal chain with alternating up/down arms ──────
export function autoLayoutTimeline(nodes:MNode[],edges:MEdge[]){
  const out=[...nodes];
  const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0)out[i]={...out[i],x,y};};
  // Find chain start (no incoming edges)
  const start=nodes.find(n=>edges.filter(e=>e.target===n.id).length===0)||nodes[0];
  if(!start)return out;
  const visited=new Set<string>();
  const chain:string[]=[];
  let cur:string|undefined=start.id;
  while(cur&&!visited.has(cur)){
    visited.add(cur);chain.push(cur);
    cur=edges.find(e=>e.source===cur)?.target;
  }
  const baseX=120,baseY=380,stepX=210;
  chain.forEach((id,i)=>{
    const yOffset=i%2===0?-110:110;
    set(id,baseX+i*stepX,baseY+yOffset);
  });
  // Place children of each node above/below its parent
  chain.forEach((pid,i)=>{
    const side=i%2===0?1:-1;
    const kids=childrenOf(pid,edges).filter(k=>!chain.includes(k));
    const px=baseX+i*stepX;
    const py=baseY+(i%2===0?-110:110);
    kids.forEach((kid,j)=>set(kid,px,py+side*(150+j*90)));
  });
  // Orphan nodes in a row below
  let ox=120;
  nodes.filter(n=>!visited.has(n.id)).forEach(n=>{set(n.id,ox,baseY+320);ox+=210;});
  return out;
}

// ── Grid: uniform grid, good for collections/kanban ───────────────
export function autoLayoutGrid(nodes:MNode[]){
  const out=[...nodes];
  if(nodes.length===0)return out;
  const set=(id:string,x:number,y:number)=>{const i=out.findIndex(n=>n.id===id);if(i>=0)out[i]={...out[i],x,y};};
  const cols=Math.max(1,Math.ceil(Math.sqrt(nodes.length*1.5)));
  const cellW=220,cellH=150;
  nodes.forEach((n,i)=>{
    const col=i%cols,row=Math.floor(i/cols);
    set(n.id,120+col*cellW,120+row*cellH);
  });
  return out;
}
