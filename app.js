const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){const [p,b]=await Promise.all([fetch('/api/public/programs').then(r=>r.json()),fetch('/api/public/buttons').then(r=>r.json())]);
 document.querySelector('#programs').innerHTML=p.map(x=>`<article class="card"><h3>${esc(x.name)}</h3><b>${esc(x.duration)}</b><p>${esc(x.description)}</p>${x.price_htg?`<strong>${Number(x.price_htg).toLocaleString()} HTG</strong>`:''}</article>`).join('');
 document.querySelector('#programSelect').innerHTML='<option value="">Choisir une formation</option>'+p.map(x=>`<option>${esc(x.name)}</option>`).join('');
 document.querySelector('#buttons').innerHTML=b.map(x=>`<a class="card link" href="${esc(x.url)}"><h3>${esc(x.label)}</h3><p>${esc(x.description)}</p></a>`).join('');
}
document.querySelector('#admissionForm').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch('/api/admissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();document.querySelector('#admissionMsg').textContent=j.ok?`Demande enregistrée. Numéro étudiant provisoire : ${j.student_no}`:(j.error||'Erreur');if(j.ok)e.target.reset();});
document.querySelector('#year').textContent=new Date().getFullYear();load();
