# Prototipo local de Uber Ride-Sharing

Monorepositorio con npm workspaces. Cada microservicio tiene su propio paquete, punto de entrada de Express y salida de compilación. Los identificadores y responsabilidades siguen el catálogo de Delivery 2.

## Requisitos

- Node.js 22 a partir de 22.18, o Node.js 24 o superior. npm 10 o superior.
- Los comandos se ejecutan desde `prototype/`.

```sh
npm ci
npm run build
npm run lint
npm test
```

`npm ci` usa el archivo de bloqueo versionado. `npm test` compila los workspaces y comprueba por HTTP las dos rutas operativas de cada servicio usando puertos efímeros.

## Ejecutar un servicio

```sh
npm run dev --workspace @uber-prototype/svc-02-ride-request
```

El modo de desarrollo reinicia el proceso cuando cambian los archivos TypeScript. Para ejecutar la versión compilada, usa `npm run build` y luego `npm start --workspace @uber-prototype/svc-02-ride-request`. Puedes compilar un único servicio con `npm run build --workspace @uber-prototype/svc-02-ride-request`.

Cada servicio expone `GET /health/live` y `GET /health/ready`. En este esqueleto, ambas rutas indican que el proceso HTTP responde. Por ejemplo, con SVC-02 activo puedes consultar `http://127.0.0.1:3002/health/ready`.

El host predeterminado es `127.0.0.1`. Para cambiar el host o un puerto, copia `.env.example` a `.env` en esta carpeta y edita los valores. Las variables del entorno del proceso tienen prioridad.

| Servicio | Workspace bajo `@uber-prototype/` | Puerto |
| --- | --- | ---: |
| Account and Driver Management | `svc-01-account-and-driver` | 3001 |
| Ride Request Management | `svc-02-ride-request` | 3002 |
| Matching and Dispatch | `svc-03-matching-and-dispatch` | 3003 |
| Trip Management and Tracking | `svc-04-trip-and-tracking` | 3004 |
| Pricing and Geospatial | `svc-05-pricing-and-geospatial` | 3005 |
| Payment and Settlement | `svc-06-payment-and-settlement` | 3006 |
| Feedback and Safety | `svc-07-feedback-and-safety` | 3007 |
| Notifications and Communications | `svc-08-notifications` | 3008 |

`packages/contracts` reserva el paquete para contratos compartidos. `packages/shared` reserva el paquete para utilidades técnicas reutilizables.

## Colaboración

1. Crea una rama desde `main` actualizada, por ejemplo `feat/1-typescript-monorepo`.
2. Abre un pull request hacia `main` e incluye `Closes #<número>` en la descripción.
3. Pide la revisión de otro integrante. Integra cambios mediante PR con revisión y los controles ejecutados.
