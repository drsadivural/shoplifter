// Re-render editable designs with your installed Playwright browser.
// From repository root: npm install --no-save playwright; npx playwright install chromium
// Start reference/server.py serve, then run node scripts/render_designs.cjs.
const fs=require('fs'),path=require('path');const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');const screens=JSON.parse(fs.readFileSync(root+'/design/screens.json'));
 const browser=await chromium.launch();const page=await browser.newPage();
 try{
  for(const lang of ['en','ja'])for(const theme of ['light','dark'])for(const s of screens){
   await page.setViewportSize({width:s.platform==='ios'?393:1440,height:s.platform==='ios'?852:1000});
   await page.goto('http://127.0.0.1:8788/design/?screen='+s.id+'&lang='+lang+'&theme='+theme);
   await page.waitForFunction(()=>window.renderDone===true);await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?null:new Promise(r=>{i.onload=r;i.onerror=r;})));});
   const folder=path.join(root,'mockups',s.platform,lang,theme);fs.mkdirSync(folder,{recursive:true});
   if(s.platform==='ios')await page.addStyleTag({content:'.tabbar{position:absolute;bottom:0}.home-indicator{position:absolute;bottom:7px}.ios-shell{position:relative}.mock-label{position:absolute;bottom:86px}'});
   await page.screenshot({path:path.join(folder,s.id+'-'+s.key+'.png'),fullPage:true});
  }
 }finally{await browser.close();}
})();
