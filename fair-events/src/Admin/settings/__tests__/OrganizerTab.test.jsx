/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OrganizerTab from '../OrganizerTab.js';
import {
	loadOrganizerSettings,
	loadAttachmentUrl,
	saveSettings,
} from '../settings-api.js';

jest.mock('../settings-api.js');

const baseOrganizer = {
	name: '',
	type: 'Organization',
	street_address: '',
	address_locality: '',
	address_region: '',
	postal_code: '',
	address_country: '',
	same_as: [],
	logo_id: 0,
	website: '',
	contact_email: '',
	contact_phone: '',
	defaults: { name: 'Test Site', website: 'https://example.com', logoId: 0 },
};

beforeEach(() => {
	loadOrganizerSettings.mockResolvedValue({ ...baseOrganizer });
	loadAttachmentUrl.mockResolvedValue('');
	saveSettings.mockResolvedValue({});
});

afterEach(() => {
	jest.clearAllMocks();
});

const nameField = () => screen.getByLabelText('Name');
const saveButton = () =>
	screen.getByRole('button', { name: /Save organizer/i });

test('renders and populates fields from loaded settings', async () => {
	loadOrganizerSettings.mockResolvedValue({
		...baseOrganizer,
		name: 'Acme Club',
		type: 'SportsClub',
	});

	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toHaveValue('Acme Club'));
	expect(screen.getByLabelText('Organization type')).toHaveValue(
		'SportsClub'
	);
});

test('adding a link renders a new row, removing it takes it away', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
	expect(screen.getAllByLabelText('Profile URL')).toHaveLength(1);

	fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
	expect(screen.queryAllByLabelText('Profile URL')).toHaveLength(0);
});

test('an invalid URL blocks save and shows a message', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
	fireEvent.change(screen.getByLabelText('Profile URL'), {
		target: { value: 'not a url' },
	});

	expect(screen.getByText(/Enter a valid URL/i)).toBeInTheDocument();
	expect(saveButton()).toBeDisabled();
});

test('save sends fair_events_organizer with the edited values', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.change(nameField(), { target: { value: 'Acme Club' } });
	fireEvent.click(saveButton());

	await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
	expect(saveSettings).toHaveBeenCalledWith({
		fair_events_organizer: expect.objectContaining({ name: 'Acme Club' }),
	});
});

test('save payload excludes the read-only site defaults', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.change(nameField(), { target: { value: 'Acme Club' } });
	fireEvent.click(saveButton());

	await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
	expect(
		saveSettings.mock.calls[0][0].fair_events_organizer
	).not.toHaveProperty('defaults');
});

test('shows the site defaults as placeholders when fields are blank', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	expect(nameField()).toHaveAttribute('placeholder', 'Test Site');
	expect(screen.getByLabelText('Website')).toHaveAttribute(
		'placeholder',
		'https://example.com'
	);
});

test('an invalid website URL blocks save', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.change(screen.getByLabelText('Website'), {
		target: { value: 'not a url' },
	});

	expect(screen.getByText(/Enter a valid URL/i)).toBeInTheDocument();
	expect(saveButton()).toBeDisabled();
});

test('save sends the contact point fields', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.change(screen.getByLabelText('Contact email'), {
		target: { value: 'info@example.com' },
	});
	fireEvent.change(screen.getByLabelText('Contact phone'), {
		target: { value: '+34 600 000 000' },
	});
	fireEvent.click(saveButton());

	await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
	expect(saveSettings).toHaveBeenCalledWith({
		fair_events_organizer: expect.objectContaining({
			contact_email: 'info@example.com',
			contact_phone: '+34 600 000 000',
		}),
	});
});

test('picking a logo stores its attachment id and shows a preview; removing it reverts', async () => {
	const handlers = {};
	const frame = {
		on: (event, cb) => {
			handlers[event] = cb;
		},
		open: () => handlers.select(),
		state: () => ({
			get: () => ({
				first: () => ({
					toJSON: () => ({
						id: 42,
						url: 'https://example.com/logo.png',
					}),
				}),
			}),
		}),
	};
	global.wp = { ...global.wp, media: jest.fn(() => frame) };

	render(<OrganizerTab onNotice={jest.fn()} />);
	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.click(screen.getByRole('button', { name: /Change image/i }));

	await waitFor(() =>
		expect(screen.getByAltText('')).toHaveAttribute(
			'src',
			'https://example.com/logo.png'
		)
	);
	const removeButton = screen.getByRole('button', { name: /^Remove$/i });
	expect(removeButton).toBeInTheDocument();

	fireEvent.click(removeButton);

	const confirmButton = await screen.findByRole('button', {
		name: /Remove logo/i,
	});
	fireEvent.click(confirmButton);

	await waitFor(() =>
		expect(
			screen.queryByRole('button', { name: /^Remove$/i })
		).not.toBeInTheDocument()
	);
});

test('cancelling the remove-logo dialog leaves the override untouched', async () => {
	const handlers = {};
	const frame = {
		on: (event, cb) => {
			handlers[event] = cb;
		},
		open: () => handlers.select(),
		state: () => ({
			get: () => ({
				first: () => ({
					toJSON: () => ({
						id: 42,
						url: 'https://example.com/logo.png',
					}),
				}),
			}),
		}),
	};
	global.wp = { ...global.wp, media: jest.fn(() => frame) };

	render(<OrganizerTab onNotice={jest.fn()} />);
	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.click(screen.getByRole('button', { name: /Change image/i }));

	await waitFor(() =>
		expect(screen.getByAltText('')).toHaveAttribute(
			'src',
			'https://example.com/logo.png'
		)
	);

	fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));

	const cancelButton = await screen.findByRole('button', {
		name: /Cancel/i,
	});
	fireEvent.click(cancelButton);

	expect(
		screen.getByRole('button', { name: /^Remove$/i })
	).toBeInTheDocument();
});
