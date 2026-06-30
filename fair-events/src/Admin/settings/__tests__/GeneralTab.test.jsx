/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import GeneralTab from '../GeneralTab.js';
import { loadGeneralSettings, saveSettings } from '../settings-api.js';

jest.mock('@wordpress/api-fetch');
jest.mock('../settings-api.js');

const baseSettings = {
	slug: 'fair-events',
	enabledPostTypes: [],
	registerPostType: true,
	poweredByBranding: false,
};

beforeEach(() => {
	window.fairEventsSettingsData = {
		eventsApiUrl: 'https://example.com/wp-json/fair-events/v1/events',
	};
	loadGeneralSettings.mockResolvedValue({ ...baseSettings });
	saveSettings.mockResolvedValue({});
	// Component fetches /wp/v2/types alongside the settings on mount.
	apiFetch.mockResolvedValue({});
});

afterEach(() => {
	jest.clearAllMocks();
});

const branding = () =>
	screen.getByRole('checkbox', {
		name: /Powered by Fair Event Plugins/i,
	});

test('renders the branding toggle, off by default', async () => {
	render(<GeneralTab onNotice={jest.fn()} />);

	await waitFor(() => expect(branding()).toBeInTheDocument());
	expect(branding()).not.toBeChecked();
});

test('toggling the branding setting and saving sends the new value', async () => {
	render(<GeneralTab onNotice={jest.fn()} />);

	await waitFor(() => expect(branding()).toBeInTheDocument());

	fireEvent.click(branding());
	expect(branding()).toBeChecked();

	fireEvent.click(screen.getByRole('button', { name: /Save Settings/i }));

	await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
	expect(saveSettings).toHaveBeenCalledWith(
		expect.objectContaining({ fair_events_powered_by_branding: true })
	);
});
