/**
 * Short manuals per role (RNF-21), in German for the pilot and Spanish for support. They are a
 * document, like the receipt labels: each language is written whole, with the exact words the
 * screens show, and printed or read on a tablet. FR, IT and EN follow with a pilot there.
 */

export const HELP_LANGUAGES = ['de', 'es'] as const;
export type HelpLanguage = (typeof HELP_LANGUAGES)[number];

export const HELP_ROLES = ['waiter', 'kitchen', 'manager', 'owner'] as const;
export type HelpRole = (typeof HELP_ROLES)[number];

export interface ManualSection {
  title: string;
  steps: readonly string[];
  tip?: string;
}

export interface Manual {
  title: string;
  intro: string;
  sections: readonly ManualSection[];
}

/** The help language for a UI language: Spanish for support, German for everyone else. */
export const helpLanguageOf = (uiLanguage: string): HelpLanguage =>
  uiLanguage === 'es' ? 'es' : 'de';

export const isHelpLanguage = (value: string): value is HelpLanguage =>
  (HELP_LANGUAGES as readonly string[]).includes(value);

export const isHelpRole = (value: string): value is HelpRole =>
  (HELP_ROLES as readonly string[]).includes(value);

export const HELP_CHROME: Record<
  HelpLanguage,
  {
    title: string;
    description: string;
    roles: Record<HelpRole, string>;
    roleHints: Record<HelpRole, string>;
    language: string;
    print: string;
    tip: string;
  }
> = {
  de: {
    title: 'Hilfe',
    description: 'Kurzanleitungen für jede Rolle. Auch ohne Internet auf der Kasse verfügbar.',
    roles: {
      waiter: 'Service',
      kitchen: 'Küche',
      manager: 'Kasse & Schichtleitung',
      owner: 'Inhaber/in',
    },
    roleHints: {
      waiter: 'Tische, Bestellungen, Senden, Kassieren',
      kitchen: 'Bons am Küchenmonitor',
      manager: 'Schicht, Freigaben, Rückerstattung, Tagesabschluss',
      owner: 'Backoffice: Einrichtung, Personal, Karte, Berichte',
    },
    language: 'Sprache',
    print: 'Drucken',
    tip: 'Tipp',
  },
  es: {
    title: 'Ayuda',
    description: 'Manuales cortos para cada rol. Disponibles en la caja incluso sin internet.',
    roles: {
      waiter: 'Mesero',
      kitchen: 'Cocina',
      manager: 'Caja y gerente',
      owner: 'Dueño',
    },
    roleHints: {
      waiter: 'Mesas, pedidos, enviar, cobrar',
      kitchen: 'Comandas en la pantalla de cocina',
      manager: 'Turno, autorizaciones, reembolsos, cierre del día',
      owner: 'Backoffice: configuración, personal, carta, reportes',
    },
    language: 'Idioma',
    print: 'Imprimir',
    tip: 'Consejo',
  },
};

const DE: Record<HelpRole, Manual> = {
  waiter: {
    title: 'Service: Bestellen und Kassieren',
    intro:
      'Die Kasse funktioniert auch ohne Internet. Alles, was Sie eingeben, bleibt auf dem Gerät gespeichert und wird später übertragen.',
    sections: [
      {
        title: 'Anmelden und abmelden',
        steps: [
          'Geben Sie Ihre PIN auf der Zifferntastatur ein und tippen Sie auf «Entsperren».',
          'Wenn Sie das Gerät verlassen, tippen Sie oben auf «Sperren». Die nächste Person meldet sich mit ihrer eigenen PIN an.',
          'Geben Sie Ihre PIN nie weiter: Jede Bestellung, jedes Storno und jede Zahlung trägt Ihren Namen.',
        ],
      },
      {
        title: 'Einen Tisch bedienen',
        steps: [
          'Öffnen Sie «Tische» und tippen Sie auf einen freien Tisch. Geben Sie die Anzahl Gäste ein und tippen Sie auf «Öffnen».',
          'Wählen Sie eine Kategorie und tippen Sie auf das Produkt. Fragt die Kasse nach einer Variante oder Option (z. B. welcher Kuchen), wählen Sie sie und tippen Sie auf «Hinzufügen».',
          'Mit «Produkt suchen» finden Sie ein Produkt nach Namen.',
          'Tippen Sie auf «Senden»: Die Positionen gehen an die richtige Station (Küche, Bar, Patisserie). Bei mehreren Gängen schicken Sie jeden Gang mit «Gang … schicken».',
          'Allergien des Tisches erfassen Sie mit «Allergien». Sie erscheinen auf jedem Bon.',
        ],
        tip: 'Farben auf dem Saalplan: frei, besetzt, in der Küche, bereit, wartet auf Zahlung. «Bereit» heisst: die Küche hat fertig – bitte servieren.',
      },
      {
        title: 'Theke und Take-away',
        steps: [
          'Tippen Sie auf «Theke» oder «Take-away» und dann auf «Neue Bestellung».',
          'Bestellen wie am Tisch; meistens wird gleich kassiert («Bezahlen»).',
          'Wenn Sie die Bestellung übergeben, tippen Sie auf «Ausgegeben».',
        ],
      },
      {
        title: 'Ändern, stornieren, Rabatt',
        steps: [
          'Tippen Sie auf eine Position und dann auf «Position bearbeiten»: Menge, Notiz, «Rabatt» oder «Stornieren» (mit Grund).',
          'Was schon in der Küche ist, braucht für ein Storno oft die «Freigabe durch Führungsperson»: Die Schichtleitung gibt ihre PIN auf Ihrem Gerät ein.',
          'Unter «Mehr» finden Sie: Tisch wechseln, Positionen übertragen, Rechnung teilen, Bedienung wechseln, Rabatt auf Bestellung.',
        ],
        tip: 'Nichts wird gelöscht: Jedes Storno bleibt mit Name, Grund und Uhrzeit sichtbar.',
      },
      {
        title: 'Kassieren',
        steps: [
          'Tippen Sie auf «Bezahlen» und wählen Sie die Zahlungsart: «Bar», «Karte» oder TWINT.',
          'Bei Bargeld geben Sie den erhaltenen Betrag bei «Gegeben» ein; die Kasse zeigt das Rückgeld. Bar wird auf 5 Rappen gerundet.',
          'Trinkgeld erfassen Sie bei «Trinkgeld» oder mit «Rückgeld als Trinkgeld». Es gehört nicht zum Umsatz.',
          'Ab CHF 400 verlangt der Beleg den «Name des Kunden».',
          'Getrennt zahlen: «Teilen» → «Gleich teilen», nach Positionen oder nach Platz.',
          'Tippen Sie auf «Zahlung bestätigen». Der Beleg erscheint; «Drucken» oder «Fertig».',
        ],
        tip: 'Bargeld geht in die offene Schicht der Kasse. Ist keine Schicht offen, bitten Sie die Schichtleitung, sie zu öffnen.',
      },
      {
        title: 'Ohne Internet',
        steps: [
          'Oben sehen Sie den Status: «Online», «Lokal (Hub)» oder «Offline». In allen drei Fällen können Sie weiterarbeiten.',
          '«Ausstehend: n» heisst: n Änderungen warten auf die Übertragung. Sie gehen automatisch hinaus, sobald die Verbindung zurück ist.',
          'Löschen Sie nie die Browserdaten der Kasse und deinstallieren Sie die App nicht: Ausstehende Änderungen gingen verloren.',
          'Meldet die Kasse eine neue Version, tippen Sie auf «Jetzt aktualisieren», wenn gerade niemand kassiert.',
        ],
      },
    ],
  },
  kitchen: {
    title: 'Küche: Bons am Küchenmonitor',
    intro:
      'Der Küchenmonitor zeigt nur die Bons Ihrer Station (Küche, Bar, Patisserie …). Er funktioniert im lokalen Netz auch ohne Internet.',
    sections: [
      {
        title: 'Station und Anmeldung',
        steps: [
          'Ist der Monitor keiner festen Station zugeordnet, fragt er zuerst «Welche Station?». Wählen Sie Ihre Station.',
          'Geben Sie Ihre PIN ein. Ein Monitor der Bar öffnet sich nur für Personen mit Zugang zu dieser Station.',
          'Mit «Andere Station wählen» wechseln Sie die Station; mit «Sperren» melden Sie sich ab.',
        ],
      },
      {
        title: 'Einen Bon abarbeiten',
        steps: [
          'Neue Bons erscheinen unter «Offen», die ältesten zuerst, mit der Wartezeit in Minuten.',
          'Tippen Sie auf «Beginnen», wenn Sie mit der Zubereitung anfangen.',
          'Tippen Sie auf «Fertig», wenn alles bereit ist. Der Service sieht es sofort auf der Kasse.',
          'Einzelne Positionen können Sie auch einzeln antippen, wenn nicht alles gleichzeitig fertig wird.',
        ],
        tip: 'Allergien des Tisches stehen gut sichtbar auf dem Bon. Lesen Sie sie vor dem Beginnen.',
      },
      {
        title: 'Änderungen und Fehler',
        steps: [
          'Wird eine Position storniert oder auf eine andere Bestellung verschoben, zeigt der Bon das an. Bestätigen Sie mit «Gesehen».',
          'Einen zu früh abgeschlossenen Bon holen Sie unter «Erledigt» mit «Zurückholen» zurück.',
          'Ist ein Drucker an der Station, druckt «Bon nachdrucken» den Bon nochmals.',
        ],
      },
    ],
  },
  manager: {
    title: 'Kasse und Schichtleitung',
    intro:
      'Die Schichtleitung öffnet und schliesst die Schichten, gibt heikle Aktionen frei und erstellt den Tagesabschluss (Z).',
    sections: [
      {
        title: 'Schicht öffnen',
        steps: [
          'Öffnen Sie auf der Kasse «Kasse».',
          'Zählen Sie das Wechselgeld nach Noten und Münzen und tippen Sie auf «Schicht mit … öffnen».',
          'Ohne offene Schicht kann diese Kasse kein Bargeld annehmen.',
        ],
      },
      {
        title: 'Während der Schicht',
        steps: [
          'Einlagen, Entnahmen und Ausgaben erfassen Sie mit «Bewegung» (Kassenbewegung), immer mit Grund.',
          'Der «X-Bericht» zeigt den Stand der Schicht, ohne sie zu schliessen.',
          'Freigaben: Wenn die Kasse «Freigabe durch Führungsperson» anzeigt, geben Sie Ihre PIN auf dem Gerät der Person ein und tippen Sie auf «Freigeben». Die Freigabe gilt nur für diese eine Aktion.',
          '«Schublade» öffnet die Kassenschublade ohne Verkauf; das wird protokolliert.',
        ],
      },
      {
        title: 'Rückerstattung, Kopie, Wieder öffnen',
        steps: [
          'Öffnen Sie «Bestellungen» → «Heute abgeschlossen» und wählen Sie die Bestellung.',
          '«Kopie drucken» druckt den Beleg mit dem Vermerk KOPIE.',
          '«Rückerstatten» bucht eine Rückerstattung mit Grund; Bargeld wird bar ausbezahlt, Karte am Terminal zurückgebucht.',
          '«Wieder öffnen» öffnet eine abgeschlossene Bestellung mit Grund. Der ursprüngliche Beleg bleibt bestehen.',
        ],
      },
      {
        title: 'Schicht schliessen',
        steps: [
          'Tippen Sie auf «Schicht abschliessen» und zählen Sie das Bargeld (Kassensturz).',
          'Gibt es eine Differenz zum Soll-Bestand, schreiben Sie die «Begründung der Differenz».',
          'Der Schichtbericht kann gedruckt werden.',
        ],
      },
      {
        title: 'Tagesabschluss (Z)',
        steps: [
          'Tippen Sie unter «Kasse» auf «Tagesabschluss» und geben Sie die PIN der Geschäftsführung ein.',
          'Die Kasse zeigt, was noch offen ist: offene Schichten und unbezahlte Bestellungen. Schliessen Sie zuerst alles ab.',
          'Geben Sie die Totale des Kartenterminals ein und begründen Sie Differenzen.',
          'Tippen Sie auf «Z-Abschluss erstellen». Der Z ist endgültig und wird für die Buchhaltung aufbewahrt.',
        ],
        tip: 'Der Z wird nie geändert. Fehler korrigiert man mit Rückerstattungen oder Bewegungen am nächsten Tag.',
      },
    ],
  },
  owner: {
    title: 'Inhaber/in: das Backoffice',
    intro:
      'Im Backoffice richten Sie das Restaurant ein und sehen die Zahlen. Sie öffnen es im Browser mit E-Mail und Passwort.',
    sections: [
      {
        title: 'Einrichten',
        steps: [
          'Die «Übersicht» zeigt eine Checkliste: Was noch fehlt, ist dort verlinkt.',
          '«Standort»: Adresse, MWST-Nummer (UID), Sprachen, Belegkopf und -fuss.',
          '«Bereiche & Tische»: der Saalplan. Ein Café mit Verkauf an der Theke braucht keinen.',
          '«Katalog»: Produkte, Kategorien und Zusatzoptionen, mit Preisen inkl. MWST und Übersetzungen.',
          '«MWST»: die Sätze und Regeln. Die Preise enthalten die MWST immer.',
        ],
      },
      {
        title: 'Geräte und Personal',
        steps: [
          '«Geräte & Stationen»: Kassen, Handhelds, Küchenmonitore, Drucker und Stationen (Küche, Bar, Patisserie).',
          'Ein neues Gerät koppeln: in der Liste auf «Kopplungscode erzeugen» tippen und den Code innert 15 Minuten auf dem Gerät eingeben.',
          'Ein verlorenes Gerät deaktivieren Sie in der Liste: Es funktioniert sofort nicht mehr.',
          '«Mitarbeitende»: Personen, Rollen und PIN. Wer geht, wird deaktiviert, nicht gelöscht.',
        ],
      },
      {
        title: 'Zahlen und Kontrolle',
        steps: [
          '«Berichte»: Umsatz, MWST, Zahlungsarten und Exporte für die Treuhand.',
          '«Kasse»: Schichten und Tagesabschlüsse (Z) mit ihren Berichten.',
          '«Protokoll»: wer was wann gemacht hat – Stornos, Rabatte, Freigaben, Änderungen.',
          '«Konflikte»: Änderungen, die sich beim Übertragen widersprochen haben. Prüfen Sie sie regelmässig.',
        ],
      },
      {
        title: 'Plan, Übung und Support',
        steps: [
          '«Mein Plan»: Ihr Plan, was Sie davon nutzen und was er enthält.',
          '«Übungsbetrieb» (in «Mein Plan»): eine Kopie Ihres Restaurants zum Üben mit derselben Karte und denselben PIN. Bestellungen dort sind nie echt; die Geräte zeigen ein oranges Band.',
          '«Support-Zugang»: Geben Sie DINOLABS befristet Zugang, wenn wir Ihnen helfen sollen. Jede Aktion des Supports wird protokolliert.',
        ],
      },
    ],
  },
};

const ES: Record<HelpRole, Manual> = {
  waiter: {
    title: 'Mesero: pedir y cobrar',
    intro:
      'La caja funciona también sin internet. Todo lo que ingresas queda guardado en el aparato y se envía después.',
    sections: [
      {
        title: 'Entrar y salir',
        steps: [
          'Escribe tu PIN en el teclado numérico y toca «Desbloquear».',
          'Cuando dejes el aparato, toca «Bloquear» arriba. La siguiente persona entra con su propio PIN.',
          'No compartas tu PIN: cada pedido, anulación y pago lleva tu nombre.',
        ],
      },
      {
        title: 'Atender una mesa',
        steps: [
          'Abre «Mesas» y toca una mesa libre. Escribe cuántos comensales son y toca «Abrir».',
          'Elige una categoría y toca el producto. Si la caja pregunta una variante u opción (por ejemplo, qué postre), elígela y toca «Agregar».',
          'Con «Buscar producto» encuentras un producto por su nombre.',
          'Toca «Enviar»: los ítems van a la estación correcta (cocina, bar, pastelería). Si hay varios tiempos, envía cada uno con «Enviar tiempo …».',
          'Las alergias de la mesa se registran con «Alergias». Aparecen en cada comanda.',
        ],
        tip: 'Colores del plano: libre, ocupada, en cocina, lista, esperando pago. «Lista» significa que la cocina terminó: hay que servir.',
      },
      {
        title: 'Barra y para llevar',
        steps: [
          'Toca «Barra» o «Para llevar» y luego «Abrir nuevo pedido».',
          'Se pide igual que en la mesa; casi siempre se cobra enseguida («Cobrar»).',
          'Cuando entregas el pedido, toca «Entregado».',
        ],
      },
      {
        title: 'Cambiar, anular, descuento',
        steps: [
          'Toca un ítem y luego «Editar ítem»: cantidad, nota, «Descuento» o «Anular» (con motivo).',
          'Lo que ya está en cocina muchas veces necesita la «Autorización de un gerente»: el gerente escribe su PIN en tu aparato.',
          'En «Más» encuentras: cambiar de mesa, transferir ítems, dividir la cuenta, cambiar mesero, descuento en el pedido.',
        ],
        tip: 'Nada se borra: cada anulación queda visible con nombre, motivo y hora.',
      },
      {
        title: 'Cobrar',
        steps: [
          'Toca «Cobrar» y elige el medio de pago: «Efectivo», «Tarjeta» o TWINT.',
          'En efectivo escribe lo recibido en «Recibido»; la caja muestra el cambio. El efectivo se redondea a 5 céntimos.',
          'La propina se registra en «Propina» o con «Cambio como propina». No es parte de la venta.',
          'Desde CHF 400 el recibo exige el «Nombre del cliente».',
          'Pagar por separado: «Dividir» → «En partes iguales», por ítems o por puesto.',
          'Toca «Confirmar pago». Aparece el recibo; «Imprimir» o «Listo».',
        ],
        tip: 'El efectivo entra en el turno abierto de la caja. Si no hay turno abierto, pide al gerente que lo abra.',
      },
      {
        title: 'Sin internet',
        steps: [
          'Arriba ves el estado: «En línea», «Local (hub)» o «Sin conexión». En los tres casos puedes seguir trabajando.',
          '«Pendientes: n» significa que n cambios esperan ser enviados. Salen solos cuando vuelve la conexión.',
          'Nunca borres los datos del navegador de la caja ni desinstales la app: se perderían los cambios pendientes.',
          'Si la caja avisa una versión nueva, toca «Actualizar ahora» cuando nadie esté cobrando.',
        ],
      },
    ],
  },
  kitchen: {
    title: 'Cocina: comandas en la pantalla',
    intro:
      'La pantalla de cocina muestra solo las comandas de tu estación (cocina, bar, pastelería…). Funciona en la red local también sin internet.',
    sections: [
      {
        title: 'Estación y entrada',
        steps: [
          'Si la pantalla no tiene una estación fija, primero pregunta «¿Qué estación?». Elige la tuya.',
          'Escribe tu PIN. La pantalla del bar solo abre para quien tiene acceso a esa estación.',
          'Con «Elegir otra estación» cambias de estación; con «Bloquear» sales.',
        ],
      },
      {
        title: 'Preparar una comanda',
        steps: [
          'Las comandas nuevas aparecen en «Abiertos», las más antiguas primero, con los minutos de espera.',
          'Toca «Empezar» cuando comiences a prepararla.',
          'Toca «Listo» cuando todo esté preparado. El mesero lo ve al instante en la caja.',
          'También puedes tocar ítems sueltos si no todo sale a la vez.',
        ],
        tip: 'Las alergias de la mesa se ven destacadas en la comanda. Léelas antes de empezar.',
      },
      {
        title: 'Cambios y errores',
        steps: [
          'Si un ítem se anula o pasa a otro pedido, la comanda lo muestra. Confírmalo con «Visto».',
          'Una comanda cerrada antes de tiempo se recupera en «Terminados» con «Recuperar».',
          'Si la estación tiene impresora, «Reimprimir comanda» la imprime otra vez.',
        ],
      },
    ],
  },
  manager: {
    title: 'Caja y gerente',
    intro:
      'El gerente abre y cierra los turnos, autoriza las acciones delicadas y hace el cierre del día (Z).',
    sections: [
      {
        title: 'Abrir el turno',
        steps: [
          'En la caja abre «Caja».',
          'Cuenta el fondo de cambio por billetes y monedas y toca «Abrir turno con …».',
          'Sin turno abierto, esa caja no puede recibir efectivo.',
        ],
      },
      {
        title: 'Durante el turno',
        steps: [
          'Entradas, retiros y gastos se registran con «Movimiento» (movimiento de caja), siempre con motivo.',
          'El «Informe X» muestra cómo va el turno sin cerrarlo.',
          'Autorizaciones: cuando la caja muestra «Autorización de un gerente», escribe tu PIN en el aparato de la persona y toca «Autorizar». Vale solo para esa acción.',
          '«Cajón» abre el cajón sin venta; queda registrado.',
        ],
      },
      {
        title: 'Reembolso, copia, reabrir',
        steps: [
          'Abre «Pedidos» → «Cerrados hoy» y elige el pedido.',
          '«Imprimir copia» imprime el recibo con la marca COPIA.',
          '«Reembolsar» registra un reembolso con motivo; el efectivo se devuelve en efectivo y la tarjeta en el terminal.',
          '«Reabrir» abre un pedido cerrado con motivo. El recibo original se conserva.',
        ],
      },
      {
        title: 'Cerrar el turno',
        steps: [
          'Toca «Cerrar turno» y cuenta el efectivo (arqueo).',
          'Si hay diferencia con lo esperado, escribe el «Motivo de la diferencia».',
          'El informe del turno se puede imprimir.',
        ],
      },
      {
        title: 'Cierre del día (Z)',
        steps: [
          'En «Caja» toca «Cierre del día» y escribe el PIN de gerencia.',
          'La caja muestra lo que falta: turnos abiertos y pedidos sin pagar. Ciérralos primero.',
          'Escribe los totales del terminal de tarjetas y explica las diferencias.',
          'Toca «Crear cierre Z». El Z es definitivo y se guarda para la contabilidad.',
        ],
        tip: 'El Z nunca se modifica. Los errores se corrigen con reembolsos o movimientos al día siguiente.',
      },
    ],
  },
  owner: {
    title: 'Dueño: el backoffice',
    intro:
      'En el backoffice se configura el restaurante y se ven los números. Se abre en el navegador con correo y contraseña.',
    sections: [
      {
        title: 'Configurar',
        steps: [
          'El «Resumen» muestra una lista de verificación con enlaces a lo que falta.',
          '«Sede»: dirección, número de IVA (UID), idiomas, encabezado y pie del recibo.',
          '«Áreas y mesas»: el plano. Un café que vende en mostrador no lo necesita.',
          '«Catálogo»: productos, categorías y modificadores, con precios con IVA incluido y traducciones.',
          '«IVA (MWST)»: las tasas y reglas. Los precios siempre incluyen el IVA.',
        ],
      },
      {
        title: 'Aparatos y personal',
        steps: [
          '«Dispositivos y estaciones»: cajas, handhelds, pantallas de cocina, impresoras y estaciones (cocina, bar, pastelería).',
          'Vincular un aparato nuevo: en la lista toca «Generar código de vinculación» y escribe el código en el aparato antes de 15 minutos.',
          'Un aparato perdido se desactiva en la lista: deja de funcionar al instante.',
          '«Personal»: personas, roles y PIN. Quien se va se desactiva, no se borra.',
        ],
      },
      {
        title: 'Números y control',
        steps: [
          '«Reportes»: ventas, IVA, medios de pago y exportaciones para la contabilidad.',
          '«Caja»: turnos y cierres del día (Z) con sus informes.',
          '«Registro de auditoría»: quién hizo qué y cuándo (anulaciones, descuentos, autorizaciones, cambios).',
          '«Conflictos»: cambios que se contradijeron al sincronizar. Revísalos con frecuencia.',
        ],
      },
      {
        title: 'Plan, práctica y soporte',
        steps: [
          '«Mi plan»: tu plan, lo que usas de él y lo que incluye.',
          '«Modo práctica» (en «Mi plan»): una copia de tu restaurante para practicar con la misma carta y los mismos PIN. Ahí nada es real; los aparatos muestran una franja naranja.',
          '«Acceso de soporte»: da a DINOLABS acceso por un tiempo cuando necesites ayuda. Cada acción del soporte queda registrada.',
        ],
      },
    ],
  },
};

export const MANUALS: Record<HelpLanguage, Record<HelpRole, Manual>> = { de: DE, es: ES };
