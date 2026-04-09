from flask import Flask, render_template, request, redirect, url_for
import os
import json

app = Flask(__name__)

TASKS_FILE = 'tasks.json'
ARCHIVED_FILE = 'archived_tasks.json'

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
    return render_template('index.html', tasks=tasks, archived_tasks=archived_tasks)

@app.route('/add', methods=['POST'])
def add_task():
    tasks = load_tasks()
    title = request.form['title']
    tasks.append({'title': title, 'status': 'pendiente'})
    save_tasks(tasks)
    return redirect(url_for('index'))
@app.route('/update_status/<int:task_id>', methods=['POST'])
def update_status(task_id):
    tasks = load_tasks()
    new_status = request.form['new_status']
    tasks[task_id]['status'] = new_status
    save_tasks(tasks)
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