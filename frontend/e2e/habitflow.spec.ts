import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const screenshots = '../docs/screenshots';

async function navigate(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
}

function watchFailures(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      failures.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      failures.push(`network: ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      failures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  return failures;
}

async function checkAccessibility(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}

test('onboarding → habit → note → completion → analytics, real local API', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const failures = watchFailures(page);
  await page.goto('/');
  await expect(page.getByPlaceholder('Il tuo nome')).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({ path: `${screenshots}/onboarding-desktop.png`, fullPage: true });
  await page.getByPlaceholder('Il tuo nome').fill('Alex');
  await navigate(page, 'Continua');
  await page.getByLabel('Fuso orario').selectOption('Europe/Rome');
  await navigate(page, 'Continua');
  await navigate(page, 'Crea la prima abitudine');
  await page.getByLabel(/Nome dell.abitudine/).fill('Leggere dieci pagine');
  await page
    .getByRole('textbox', { name: 'Obiettivo', exact: true })
    .fill('Un piccolo spazio per nuove idee.');
  await page.getByRole('combobox', { name: 'Frequenza', exact: true }).selectOption('daily');
  await page.getByRole('button', { name: /^(Inizia|Salva abitudine)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Buongiorno.' })).toBeVisible();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Leggere dieci pagine' }) });
  await card.getByRole('button', { name: 'Aggiungi una nota' }).click();
  await card.getByLabel('Nota per oggi').fill('Dieci pagine prima del caffè.');
  const complete = card.getByRole('button', { name: 'Segna completata Leggere dieci pagine' });
  await complete.focus();
  await page.keyboard.press('Enter');
  await expect(
    card.getByRole('button', { name: 'Annulla completamento Leggere dieci pagine' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    card.getByRole('button', { name: 'Annulla completamento Leggere dieci pagine' }),
  ).toBeVisible();
  await expect(card.getByLabel('Nota per oggi')).toHaveValue('Dieci pagine prima del caffè.');
  await navigate(page, 'Impostazioni');
  await navigate(page, 'Carica dataset demo');
  await expect(page.getByText(/Dataset demo aggiunto/)).toBeVisible();
  await navigate(page, 'Oggi');
  await checkAccessibility(page);
  await expect(page.locator('.sr-notice')).toHaveText('');
  await page.screenshot({ path: `${screenshots}/today-desktop.png`, fullPage: true });
  await navigate(page, 'Progressi');
  await expect(
    page.getByRole('heading', { name: /Il tuo percorso|Progressi|La tua costanza/ }),
  ).toBeVisible();
  await expect(page.locator('.heatmap')).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({ path: `${screenshots}/analytics-desktop.png`, fullPage: true });
  expect(failures).toEqual([]);
});

test('lifecycle, edit, search, idempotent backup roundtrip and explicit delete', async ({ page }) => {
  const failures = watchFailures(page);
  await page.request.patch('/api/v1/settings', { data: { onboarding_completed: true } });
  await page.goto('/');
  await navigate(page, 'Abitudini');
  await navigate(page, 'Nuova abitudine');
  await page.getByLabel(/Nome dell.abitudine/).fill('Piano flessibile E2E');
  await page.getByRole('combobox', { name: 'Frequenza', exact: true }).selectOption('times_per_week');
  await page.getByRole('spinbutton', { name: 'Volte a settimana', exact: true }).fill('3');
  await navigate(page, 'Salva abitudine');
  await expect(page.getByRole('heading', { name: 'Buongiorno.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Piano flessibile E2E' })).toBeVisible();
  await navigate(page, 'Abitudini');
  await page.getByLabel('Cerca abitudini').fill('Piano flessibile E2E');
  const row = page.getByRole('article').filter({ hasText: 'Piano flessibile E2E' });
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' })).toBeFocused();
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: 'Metti in pausa', exact: true }).click();
  await expect(row.getByText('In pausa', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: /Riprendi senza colpa|^Riprendi$/ }).click();
  await expect(row.getByText('Attiva', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: /Modifica/ }).click();
  await page
    .getByRole('textbox', { name: 'Obiettivo', exact: true })
    .fill('Tre momenti, senza recuperi forzati.');
  await page.getByRole('combobox', { name: 'Icona', exact: true }).selectOption('flower');
  await page.getByRole('combobox', { name: 'Colore', exact: true }).selectOption('#a65e35');
  await page.getByLabel('Fuso orario IANA').fill('America/New_York');
  await page.getByRole('button', { name: /Salva modifiche|Salva abitudine/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.getByText('Tre momenti, senza recuperi forzati.')).toBeVisible();
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: 'Modifica', exact: true }).click();
  await expect(page.getByText(/Piano già programmato dal/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Obiettivo', exact: true }).fill('Tre momenti, al mio ritmo.');
  await page.getByRole('button', { name: 'Salva modifiche', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const savedHabits = await (await page.request.get('/api/v1/habits')).json();
  const updated = savedHabits.find((habit: { name: string }) => habit.name === 'Piano flessibile E2E');
  expect(updated.pending_schedule.timezone).toBe('America/New_York');
  expect(updated.icon).toBe('flower');
  expect(updated.color).toBe('#a65e35');
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: 'Archivia', exact: true }).click();
  await expect(row.getByText('Archiviata', { exact: true })).toBeVisible();
  await navigate(page, 'Oggi');
  await expect(page.getByRole('heading', { name: 'Piano flessibile E2E' })).toHaveCount(0);
  await navigate(page, 'Impostazioni');
  const downloadPromise = page.waitForEvent('download');
  await navigate(page, 'Esporta JSON');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/habitflow-backup.*\.json/);
  const backup = await (await page.request.get('/api/v1/data/export')).json();
  await page.locator('input[type=file]').setInputFiles({
    name: 'roundtrip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText(/Importazione completata/)).toBeVisible();
  await navigate(page, 'Abitudini');
  await page.getByLabel('Cerca abitudini').fill('Piano flessibile E2E');
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: 'Ripristina', exact: true }).click();
  await expect(row.getByText('Attiva', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Azioni per Piano flessibile E2E' }).click();
  await page.getByRole('button', { name: 'Elimina definitivamente', exact: true }).click();
  await page.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('mobile, tablet, landscape and large text stay usable and accessible', async ({ page }) => {
  const failures = watchFailures(page);
  await page.request.patch('/api/v1/settings', { data: { onboarding_completed: true } });
  await page.request.post('/api/v1/data/demo');
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Buongiorno.' })).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({ path: `${screenshots}/today-mobile.png`, fullPage: true });
  await navigate(page, 'Progressi');
  await expect(page.locator('.heatmap')).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({ path: `${screenshots}/analytics-mobile.png`, fullPage: true });
  for (const viewport of [
    { width: 375, height: 900 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `No page overflow at ${viewport.width}x${viewport.height}`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.addStyleTag({ content: 'html { font-size: 125% !important; }' });
  const enlargedLayout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    overflowing: [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => `${element.tagName}.${element.className}`)
      .slice(0, 12),
  }));
  expect(enlargedLayout.width, JSON.stringify(enlargedLayout)).toBeLessThanOrEqual(
    enlargedLayout.viewport,
  );
  expect(failures).toEqual([]);
});

test('connection failure explains the problem and Retry recovers', async ({ page }) => {
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'offline', message: 'API temporaneamente non disponibile.', details: [] },
      }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('API temporaneamente non disponibile.')).toBeVisible();
  await page.unroute('**/api/v1/settings');
  await navigate(page, 'Riprova');
  await expect(page.getByRole('heading', { name: 'Buongiorno.' })).toBeVisible();
});
