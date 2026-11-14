import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export type BodyRegion = 'ears' | 'head' | 'chest' | 'pelvis' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
type Ring = [number, number, number, number]; // height, half-width, half-depth, horizontal offset

/** A sparse, volumetric mannequin. Dimensions in metres; feet at y=0. */
export function createCrewAvatar() {
  const root = new THREE.Group();
  const regions = new Map<BodyRegion, THREE.Group>();
  const pickTargets: THREE.Mesh[] = [];
  const resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  const white = 0xeeeeee;

  function part(region: BodyRegion, rings: Ring[], zOffset = 0) {
    let group = regions.get(region);
    if (!group) {
      group = new THREE.Group();
      group.name = region;
      regions.set(region, group);
      root.add(group);
    }
    // Bevelled rectangular rings avoid the visual noise of triangulated meshes.
    const profile = [[-.65,-1],[.65,-1],[1,-.65],[1,.65],[.65,1],[-.65,1],[-1,.65],[-1,-.65]];
    const vertices: number[] = [];
    for (const [y,w,d,x] of rings) for (const [px,pz] of profile) vertices.push(x+px*w,y,zOffset+pz*d);
    const indices: number[] = [];
    for (let r=0;r<rings.length-1;r++) for (let i=0;i<8;i++) {
      const a=r*8+i,b=r*8+(i+1)%8,c=(r+1)*8+i,d=(r+1)*8+(i+1)%8;
      indices.push(a,c,b,b,c,d);
    }
    for(let i=1;i<7;i++) indices.push(0,i+1,i);
    const end=(rings.length-1)*8;
    for(let i=1;i<7;i++) indices.push(end,end+i,end+i+1);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setIndex(indices);
    const fill=new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:4,polygonOffsetUnits:4});
    const mesh=new THREE.Mesh(geometry,fill);
    mesh.userData.region=region;
    group.add(mesh);
    pickTargets.push(mesh);
    const lines:number[]=[];
    const edge=(a:number,b:number)=>lines.push(...vertices.slice(a*3,a*3+3),...vertices.slice(b*3,b*3+3));
    for(let r=0;r<rings.length;r++) for(let i=0;i<8;i++) edge(r*8+i,r*8+(i+1)%8);
    // Four longitudinal edges keep the silhouette readable without a dense cage.
    for(let r=0;r<rings.length-1;r++) for(const i of [0,2,4,6]) edge(r*8+i,(r+1)*8+i);
    const lineGeometry=new LineSegmentsGeometry();
    lineGeometry.setPositions(lines);
    const material=new LineMaterial({color:white,linewidth:1.35,worldUnits:false,depthTest:true});
    const outline=new LineSegments2(lineGeometry,material);
    outline.renderOrder=1;
    group.add(outline);
    resources.push(geometry,fill,lineGeometry,material);
  }

  for(const side of [-1,1]) part('ears',[[1.635,.018,.022,side*.108],[1.685,.018,.022,side*.108]]);
  part('head',[[1.57,.068,.065,0],[1.60,.096,.083,0],[1.73,.103,.087,0],[1.79,.077,.069,0]]);
  part('head',[[1.49,.049,.047,0],[1.58,.049,.047,0]]);
  part('chest',[[1.075,.118,.075,0],[1.27,.169,.095,0],[1.40,.183,.088,0],[1.46,.145,.073,0],[1.50,.081,.058,0]]);
  part('pelvis',[[.91,.095,.067,0],[.97,.151,.085,0],[1.075,.118,.075,0]]);
  for(const side of [-1,1]) {
    const arm:BodyRegion=side<0?'leftArm':'rightArm';
    const leg:BodyRegion=side<0?'leftLeg':'rightLeg';
    part(arm,[[1.07,.047,.048,side*.257],[1.34,.062,.06,side*.214],[1.41,.052,.052,side*.18]]);
    part(arm,[[.82,.031,.035,side*.308],[.99,.044,.044,side*.282],[1.07,.047,.048,side*.257]]);
    part(arm,[[.68,.028,.026,side*.318],[.705,.044,.03,side*.328],[.775,.047,.033,side*.321],[.82,.031,.035,side*.308]]);
    // A short attached thumb gives a human silhouette without individual fingers.
    part(arm,[[.715,.016,.02,side*.275],[.77,.02,.026,side*.279]] , .012);
    part(leg,[[.54,.056,.058,side*.106],[.77,.074,.073,side*.091],[.965,.077,.073,side*.079]]);
    part(leg,[[.10,.036,.039,side*.119],[.34,.054,.057,side*.113],[.45,.057,.057,side*.108],[.54,.056,.058,side*.106]]);
    part(leg,[[.025,.047,.095,side*.119],[.065,.047,.095,side*.119],[.105,.037,.057,side*.119]],.043);
  }
  return {
    root, regions, pickTargets,
    highlight(region: BodyRegion | null, color = 0x91acd8) {
      for(const [key,group] of regions) group.traverse(object=>{
        if(object instanceof LineSegments2) (object.material as LineMaterial).color.setHex(key===region?color:white);
      });
    },
    dispose(){resources.forEach(resource=>resource.dispose());root.removeFromParent();},
  };
}
