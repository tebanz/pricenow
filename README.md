# PriceNow — Observatorio Ciudadano de Precios · Rancagua

## 1. Arquitectura General

```
┌──────────────────────────────────────────────────────────┐
│                     CLIENTE (Browser/PWA)                │
│              React + Vite  ·  TailwindCSS                │
│                                                          │
│  Auth  │  Registro Manual  │  Ranking  │  Reportes      │
└────────────────────┬─────────────────────────────────────┘
                     │  HTTPS / REST + Realtime
┌────────────────────▼─────────────────────────────────────┐
│                     SUPABASE                             │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Auth       │  │  PostgreSQL  │  │  Storage       │  │
│  │  (JWT/RLS)  │  │  (datos)     │  │  (fotos boleta)│  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Row Level Security (RLS) — políticas por tabla     │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Capas de la aplicación

| Capa | Tecnología | Función |
|------|-----------|---------|
| Frontend | React 18 + Vite 5 | SPA responsive, mobile-first |
| Estilos | TailwindCSS 3 | Sistema de diseño utilitario |
| Routing | React Router v6 | Navegación SPA |
| Estado global | React Context + useReducer | Auth y datos de usuario |
| Backend | Supabase (BaaS) | API REST, Auth, Storage |
| Base de datos | PostgreSQL (Supabase) | Datos relacionales |
| Almacenamiento | Supabase Storage | Fotos de boletas |
| Seguridad | Row Level Security | Control de acceso a nivel fila |

---

## 2. Estructura de Carpetas

```
pricenow/
├── public/
│   └── pricenow-icon.svg
├── src/
│   ├── lib/
│   │   └── supabase.js          # Cliente Supabase
│   ├── hooks/
│   │   ├── useAuth.js           # Hook autenticación
│   │   └── usePrices.js         # Hook consultas de precios
│   ├── components/
│   │   ├── Auth/
│   │   │   └── AuthPage.jsx     # Login / Registro
│   │   ├── Layout/
│   │   │   ├── Layout.jsx       # Wrapper principal
│   │   │   └── BottomNav.jsx    # Navegación móvil
│   │   ├── UI/
│   │   │   ├── PriceCard.jsx    # Tarjeta de precio
│   │   │   ├── Badge.jsx        # Badges de estado
│   │   │   └── Spinner.jsx      # Loading
│   │   └── Forms/
│   │       └── PriceForm.jsx    # Formulario ingreso manual
│   ├── pages/
│   │   ├── Home.jsx             # Dashboard resumen
│   │   ├── AddPrice.jsx         # Ingresar precio
│   │   ├── Ranking.jsx          # Ranking por producto
│   │   ├── Report.jsx           # Reporte semanal
│   │   └── Validate.jsx         # Panel validación (admin)
│   ├── utils/
│   │   └── priceCalc.js         # Cálculo precio por unidad
│   ├── context/
│   │   └── AuthContext.jsx      # Contexto de autenticación
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── supabase/
│   ├── schema.sql               # Tablas y relaciones
│   └── policies.sql             # Políticas RLS
├── .env.example
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README.md
```

---

## 3. Modelo de Base de Datos

```
┌──────────────────┐       ┌──────────────────────────────┐
│     profiles     │       │          price_entries        │
│──────────────────│       │──────────────────────────────│
│ id (uuid, PK)    │◄──┐   │ id (uuid, PK)                │
│ email            │   └───│ user_id (uuid, FK)            │
│ username         │       │ product_name (text)           │
│ role (enum)      │       │ brand (text, nullable)        │
│ is_verified      │       │ quantity (numeric)            │
│ created_at       │       │ unit (enum)                   │
└──────────────────┘       │ price (numeric)               │
                           │ unit_price (numeric, calc)    │
                           │ store_name (text)             │
┌──────────────────┐       │ sector (text)                 │
│     products     │       │ purchase_date (date)          │
│──────────────────│       │ receipt_photo_url (text)      │
│ id (uuid, PK)    │◄──────│ product_id (uuid, FK)         │
│ name (text)      │       │ validation_status (enum)      │
│ category (text)  │       │ created_at                    │
│ canonical_name   │       └──────────────────────────────┘
│ created_at       │
└──────────────────┘       ┌──────────────────────────────┐
                           │       weekly_reports          │
                           │──────────────────────────────│
                           │ id (uuid, PK)                 │
                           │ product_id (uuid, FK)         │
                           │ week_start (date)             │
                           │ week_end (date)               │
                           │ avg_price (numeric)           │
                           │ min_price (numeric)           │
                           │ max_price (numeric)           │
                           │ price_change_pct (numeric)    │
                           │ sample_count (int)            │
                           │ created_at                    │
                           └──────────────────────────────┘
```

### Enums

| Enum | Valores |
|------|---------|
| `unit_type` | `unidad`, `kg`, `g`, `litro`, `ml`, `metro`, `par`, `caja` |
| `validation_status` | `pending`, `approved`, `rejected` |
| `user_role` | `user`, `validator`, `admin` |

---

## 5. Instrucciones para Ejecutar

### Pre-requisitos
- Node.js >= 18
- Cuenta gratuita en [supabase.com](https://supabase.com)

### Pasos

**1. Clonar e instalar dependencias**
```bash
git clone https://github.com/tu-usuario/pricenow.git
cd pricenow
npm install
```

**2. Configurar Supabase**
- Crear un proyecto nuevo en Supabase
- Ir a **SQL Editor** y ejecutar `supabase/schema.sql`
- Luego ejecutar `supabase/policies.sql`
- En **Storage**, crear un bucket llamado `receipts` (público: NO)

**3. Variables de entorno**
```bash
cp .env.example .env
# Editar .env con tus credenciales de Supabase
```

Para la busqueda estable de negocios cercanos, agrega tambien:

```bash
GEOAPIFY_API_KEY=mi_clave
```

En Vercel, crea la misma variable `GEOAPIFY_API_KEY` en Project Settings > Environment Variables. No modifiques `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY`.

**4. Ejecutar en desarrollo**
```bash
npm run dev
# Abre http://localhost:5173
```

**5. Build para producción**
```bash
npm run build
npm run preview
```

### Deploy recomendado
- **Frontend**: [Vercel](https://vercel.com) (gratis, conectar repo GitHub)
- **Backend**: Supabase plan Free (incluye PostgreSQL + Storage)

---

## 6. Seguridad y Privacidad

### Autenticación
- Supabase Auth con JWT — tokens expiran en 1 hora (refresh automático)
- Contraseñas hasheadas con bcrypt por Supabase
- Confirmación de email obligatoria antes de contribuir datos

### Control de acceso (Row Level Security)
- Cada usuario solo puede **ver sus propios** registros no validados
- Registros **aprobados** son públicos (lectura) para todos
- Solo `role = validator` o `admin` puede aprobar/rechazar entradas
- Fotos de boletas en bucket privado: acceso solo por signed URL (1h)

### Privacidad de datos
- No se recolectan datos de geolocalización exacta (solo sector/barrio)
- Las fotos de boletas pueden contener datos personales — NO se hacen públicas
- Opción de ingresar datos sin foto (campo opcional)
- Cumplimiento con Ley 19.628 de Chile (Protección de Datos Personales)

### Preparación para IA (futura integración)
- La tabla `price_entries` incluye `receipt_photo_url` para OCR futuro
- La tabla `products` tiene `canonical_name` para normalización con NLP
- La columna `validation_status` permite flujo humano → IA → humano

### Buenas prácticas adicionales
- Variables de entorno **nunca** en el repositorio (`.env` en `.gitignore`)
- HTTPS obligatorio en producción (Vercel + Supabase lo manejan)
- Rate limiting en formularios (debounce 500ms + validación client-side)
- Sanitización de inputs: sin HTML en campos de texto
