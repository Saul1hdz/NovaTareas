
from flask import Flask, render_template, request, redirect, url_for
import os
import json

app = Flask(__name__)

# Ruta para actualizar prioridad
@app.route('/update_prioridad/<int:task_id>', methods=['POST'])
def update_prioridad(task_id):
    tasks = load_tasks()
    nueva_prioridad = int(request.form.get('nueva_prioridad', 1))
    tasks[task_id]['prioridad'] = nueva_prioridad
    save_tasks(tasks)
    return redirect(url_for('index'))

TASKS_FILE = 'tasks.json'
ARCHIVED_FILE = 'archived_tasks.json'
RECOMMENDATION_FILE = 'recommendation.json'
# Funciones para recomendación
def load_recommendation():
    if os.path.exists(RECOMMENDATION_FILE):
        with open(RECOMMENDATION_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"selected_task": None}

def save_recommendation(data):
    with open(RECOMMENDATION_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# Cargar tareas

def load_tasks():
    if os.path.exists(TASKS_FILE):
        with open(TASKS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def save_tasks(tasks):
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)

# Cargar tareas archivadas

def load_archived():
    if os.path.exists(ARCHIVED_FILE):
        with open(ARCHIVED_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def save_archived(tasks):
    with open(ARCHIVED_FILE, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)

@app.route('/')
def index():
    tasks = load_tasks()
    archived_tasks = load_archived()
    recommendation = load_recommendation()
    selected_task = None
    if recommendation["selected_task"] is not None:
        idx = recommendation["selected_task"]
        if 0 <= idx < len(tasks) and tasks[idx]["status"] == "proceso":
            selected_task = tasks[idx]
        else:
            # Limpiar recomendación si ya no es válida
            save_recommendation({"selected_task": None})
    return render_template('index.html', tasks=tasks, archived_tasks=archived_tasks, selected_task=selected_task)

@app.route('/add', methods=['POST'])
def add_task():
    from datetime import datetime
    tasks = load_tasks()
    title = request.form['title']
    # Fecha de creación automática
    created_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # Fecha límite seleccionada por el usuario
    due_date = request.form.get('due_date', '')
    prioridad = int(request.form.get('prioridad', 1))
    descripcion = request.form.get('descripcion', '')
    tasks.append({
        'title': title,
        'descripcion': descripcion,
        'status': 'pendiente',
        'created_at': created_at,
        'due_date': due_date,
        'start_time': '',
        'end_time': '',
        'duration': '',
        'prioridad': prioridad
    })
    save_tasks(tasks)
    return redirect(url_for('index'))
@app.route('/update_status/<int:task_id>', methods=['POST'])
def update_status(task_id):
    from datetime import datetime
    tasks = load_tasks()
    new_status = request.form['new_status']
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # Si pasa a "proceso" y no tiene start_time, lo guardamos
    if new_status == 'proceso' and not tasks[task_id].get('start_time'):
        tasks[task_id]['start_time'] = now
    # Si pasa a "terminada" y no tiene end_time, lo guardamos y calculamos duración
    if new_status == 'terminada' and not tasks[task_id].get('end_time'):
        tasks[task_id]['end_time'] = now
        # Calcular duración si hay start_time
        if tasks[task_id].get('start_time'):
            fmt = '%Y-%m-%d %H:%M:%S'
            try:
                start_dt = datetime.strptime(tasks[task_id]['start_time'], fmt)
                end_dt = datetime.strptime(now, fmt)
                duration = end_dt - start_dt
                # Mostrar duración en formato legible
                days = duration.days
                hours, remainder = divmod(duration.seconds, 3600)
                minutes, seconds = divmod(remainder, 60)
                dur_str = f"{days}d {hours}h {minutes}m {seconds}s" if days > 0 else f"{hours}h {minutes}m {seconds}s"
                tasks[task_id]['duration'] = dur_str
            except Exception:
                tasks[task_id]['duration'] = ''
    tasks[task_id]['status'] = new_status
    save_tasks(tasks)
    # Si la tarea recomendada pasa a terminada o abandonada, limpiar recomendación
    recommendation = load_recommendation()
    if recommendation["selected_task"] == task_id and new_status in ["terminada", "abandonada"]:
        save_recommendation({"selected_task": None})
    return redirect(url_for('index'))

# Ruta para seleccionar tarea recomendada
@app.route('/select_recommendation/<int:task_id>', methods=['POST'])
def select_recommendation(task_id):
    tasks = load_tasks()
    if 0 <= task_id < len(tasks) and tasks[task_id]["status"] == "proceso":
        save_recommendation({"selected_task": task_id})
    return redirect(url_for('index'))

@app.route('/archive/<int:task_id>', methods=['GET', 'POST'])
def archive_task(task_id):
    tasks = load_tasks()
    archived = load_archived()
    task = tasks.pop(task_id)
    if request.method == 'POST':
        notes = request.form['notes']
        task['notes'] = notes
        archived.append(task)
        save_archived(archived)
        save_tasks(tasks)
        return redirect(url_for('index'))
    return render_template('archive.html', task=task, task_id=task_id)

@app.route('/archived')
def archived():
    archived = load_archived()
    return render_template('archived.html', tasks=archived)

if __name__ == '__main__':
    app.run(debug=True)