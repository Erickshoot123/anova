const evaluation = document.querySelector('#calificar');
const steps = [...evaluation.querySelectorAll('fieldset')];
const back = document.querySelector('#volver');
const next = document.querySelector('#seguir');
const result = document.querySelector('#dictamen');
const contact = document.querySelector('#contacto');
let current = 0;
let submissionId;
function showStep(index) {
  current = index;
  steps.forEach((step, i) => { step.hidden = step.disabled = i !== index; });
  back.hidden = index === 0;
  next.textContent = index === 4 ? 'Ver mi resultado' : 'Siguiente →';
  document.querySelector('#paso').textContent = 'Pregunta ' + (index + 1) + ' de 5';
  steps[index].querySelector('legend').focus();
}
async function sendData(path, values) {
  const response = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
back.addEventListener('click', () => showStep(current - 1));
evaluation.addEventListener('submit', async event => {
  event.preventDefault();
  if (current < 4) return showStep(current + 1);
  next.disabled = back.disabled = true;
  const status = evaluation.querySelector('[role=status]');
  status.textContent = 'Guardando evaluación…';
  try {
    submissionId ||= crypto.randomUUID();
    const values = { id:submissionId };
    for (const step of steps) {
      const input = step.querySelector('input:checked, input[type=number]');
      values[input.name] = input.value;
    }
    const { estado, agenda } = await sendData('/api/calificar', values);
    const mensajes = {
      'Ideal':'¡Gracias! Tu negocio parece encajar con el perfil de ANOVA. El siguiente paso es una evaluación gratuita.',
      'Revisión manual':'Gracias por compartir tus datos. Revisaremos tu caso para determinar si nuestro método es adecuado para tu negocio.',
      'No califica':'Gracias por tu interés. Por ahora, nuestro servicio no parece ser el más adecuado para las características de tu negocio.'
    };
    evaluation.hidden = true;
    result.hidden = false;
    result.querySelector('h3').textContent = estado;
    result.querySelector('p').textContent = mensajes[estado];
    const link = document.querySelector('#agenda');
    if (agenda) { link.href = agenda; link.hidden = false; }
    contact.hidden = estado === 'No califica' || Boolean(agenda);
    if (estado === 'Ideal' && !agenda) result.querySelector('p').textContent += ' Déjanos tu teléfono para coordinar la llamada.';
    result.querySelector('h3').focus();
    revealAnswer(result);
  } catch (err) { status.textContent = err.message || 'Inténtalo nuevamente.'; }
  finally { next.disabled = back.disabled = false; }
});
contact.addEventListener('submit', async event => {
  event.preventDefault();
  const button = contact.querySelector('button');
  button.disabled = true;
  try {
    await sendData('/api/contacto', { id:submissionId, ...Object.fromEntries(new FormData(contact)) });
    contact.replaceChildren(document.createTextNode('Gracias. Guardamos tu contacto para el seguimiento.'));
  } catch (err) { contact.querySelector('[role=status]').textContent = err.message; button.disabled = false; }
});

const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
function revealAnswer(element) {
  if (!window.Motion || motionPreference.matches) return;
  Motion.animate(element, { opacity: [0.45, 1], transform: ['translateY(5px)', 'translateY(0)'] }, { duration: 0.22, ease: 'easeOut' });
}

document.querySelectorAll('#faq details').forEach(item => {
  item.addEventListener('toggle', () => {
    if (item.open) revealAnswer(item.querySelector('p'));
  });
});

if (window.Motion) {
  Motion.inView('.trend polyline', line => {
    if (motionPreference.matches) return;
    const length = line.getTotalLength();
    line.style.strokeDasharray = String(length);
    Motion.animate(line, { strokeDashoffset: [length, 0] }, { duration: 0.75, ease: 'easeOut' });
  });
}
