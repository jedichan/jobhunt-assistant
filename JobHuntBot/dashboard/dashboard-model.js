/* Shared, pure display rules. Source CSV files are never changed by this UI. */
(function(root) {
  'use strict';
  const statusNames = {'Preliminary':'初筛完成','Needs review':'待核验','Needs user':'待你处理','Pending':'待推进','Submitted':'已投递','Offer':'已录用','Rejected':'未通过','Skipped':'已跳过','Blocked':'受阻'};
  const cities = ['南京','无锡','苏州','上海','杭州','合肥','北京','深圳','广州','成都','武汉','西安','天津','重庆','济南','宁波','常州','厦门','福州','长沙','青岛'].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const key = r => [r.company,r.job_title,r.location,r.job_url].map(v=>String(v||'').trim()).join('\u001f');
  function mergeJobs(preliminary, jobs) {
    const map = new Map();
    for (const row of preliminary) map.set(key(row), {...row,_pool:'preliminary'});
    for (const row of jobs) {
      const old = map.get(key(row)) || {};
      const values = Object.fromEntries(Object.entries(row).filter(([,v])=>v!=='' && v!=null));
      map.set(key(row),{...old,...values,status:row.status||'',_pool:'jobs'});
    }
    return [...map.values()].map(r=>({...r,_id:r.lead_id||'job:'+key(r),_cities:cities.filter(c=>(r.location||'').includes(c))}));
  }
  function exactDate(value) {
    const str=String(value||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}(?:$|[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$)/.test(str)) return null;
    const d=str.slice(0,10), n=Date.parse(d+'T00:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0,10)===d ? d : null;
  }
  function deadline(row,today){const d=exactDate(row.application_deadline);if(!d)return null;return {date:d,days:Math.round((Date.parse(d+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000)};}
  function typeOf(row){const s=row.company_type||'';return /国企|央企|中央企业|省属|市属|国有|国控/.test(s)?'soe':/外资|外企|三资/.test(s)?'foreign':'other';}
  function safeURL(value){try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
  function filterJobs(rows, filters, today, saved) {
    let out=rows.filter(r=>filters.view!=='applied'||r._pool==='jobs');
    if(filters.scope==='today')out=out.filter(r=>r.date_found===today);
    if(filters.scope==='p1')out=out.filter(r=>r.priority==='P1');
    if(filters.scope==='saved')out=out.filter(r=>saved.has(r._id));
    if(filters.city)out=out.filter(r=>r._cities.includes(filters.city));
    if(filters.type)out=out.filter(r=>typeOf(r)===filters.type);
    if(filters.status)out=out.filter(r=>filters.status==='__review'?['Needs review','Needs user'].includes(r.status):r.status===filters.status);
    const q=(filters.query||'').toLocaleLowerCase().trim();
    if(q)out=out.filter(r=>[r.company,r.job_title,r.role_family,r.fit_summary,r.location,r.lead_id].join(' ').toLocaleLowerCase().includes(q));
    const fresh=(a,b)=>(b.date_found||'').localeCompare(a.date_found||'');
    const pri=(a,b)=>(a.priority||'P9').localeCompare(b.priority||'P9');
    return out.sort(filters.sort==='priority'?(a,b)=>pri(a,b)||fresh(a,b):filters.sort==='deadline'?(a,b)=>(exactDate(a.application_deadline)||'9999').localeCompare(exactDate(b.application_deadline)||'9999')||fresh(a,b):(a,b)=>fresh(a,b)||pri(a,b));
  }
  const api={statusNames,cities,key,mergeJobs,exactDate,deadline,typeOf,safeURL,filterJobs};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.JobModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
