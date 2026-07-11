/**
 * ProfileForm.jsx
 * Formulario de creación/edición de perfil de usuario.
 * Muestra y valida el campo `telefono`.
 */

import { useState } from 'react';

export default function ProfileForm({ initialData = {}, mode = 'edit' }) {
  const [form, setForm] = useState({
    name: initialData.name || '',
    email: initialData.email || '',
    telefono: initialData.telefono || '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validaciones del lado del cliente
    if (mode === 'register' && (!form.name || !form.email || !form.password || !form.telefono)) {
      return setError('Todos los campos son obligatorios.');
    }

    if (form.telefono && !PHONE_REGEX.test(form.telefono.trim())) {
      return setError('Formato de teléfono inválido. Usa el formato internacional, p.ej. +50312345678.');
    }

    if (form.password && form.password !== form.confirmPassword) {
      return setError('Las contraseñas no coinciden.');
    }

    setLoading(true);

    try {
      const endpoint = mode === 'register' ? '/api/register' : '/api/profile';
      const method = mode === 'register' ? 'POST' : 'PUT';

      const payload =
        mode === 'register'
          ? { name: form.name, email: form.email, password: form.password, telefono: form.telefono }
          : {
              ...(form.name && { name: form.name }),
              ...(form.telefono && { telefono: form.telefono }),
              ...(form.password && { password: form.password }),
            };

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Ocurrió un error. Inténtalo de nuevo.');
      } else {
        if (mode === 'register') {
          window.location.href = '/';
        } else {
          setSuccess('Perfil actualizado correctamente.');
        }
      }
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="profile-form" noValidate>
      {/* Nombre */}
      <div className="form-group">
        <label htmlFor="name">Nombre completo</label>
        <input
          id="name"
          name="name"
          type="text"
          value={form.name}
          onChange={handleChange}
          placeholder="Tu nombre"
          autoComplete="name"
          required={mode === 'register'}
        />
      </div>

      {/* Email (solo en registro) */}
      {mode === 'register' && (
        <div className="form-group">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="correo@ejemplo.com"
            autoComplete="email"
            required
          />
        </div>
      )}

      {/* Teléfono */}
      <div className="form-group">
        <label htmlFor="telefono">
          Teléfono <span className="required">*</span>
        </label>
        <input
          id="telefono"
          name="telefono"
          type="tel"
          value={form.telefono}
          onChange={handleChange}
          placeholder="+50312345678"
          autoComplete="tel"
          required={mode === 'register'}
        />
        <small className="hint">Formato internacional, p.ej. +50312345678</small>
      </div>

      {/* Contraseña */}
      <div className="form-group">
        <label htmlFor="password">
          {mode === 'register' ? 'Contraseña' : 'Nueva contraseña'}
          {mode === 'edit' && <span className="optional"> (opcional)</span>}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : 'Dejar en blanco para no cambiar'}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required={mode === 'register'}
          minLength={6}
        />
      </div>

      {/* Confirmar contraseña */}
      {(mode === 'register' || form.password) && (
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirmar contraseña</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={handleChange}
            placeholder="Repite la contraseña"
            autoComplete="new-password"
            required={mode === 'register' || !!form.password}
          />
        </div>
      )}

      {/* Mensajes */}
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? 'Guardando...' : mode === 'register' ? 'Crear cuenta' : 'Guardar cambios'}
      </button>
    </form>
  );
}
