/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

const mockSelect = jest.fn();
jest.mock('@wordpress/data', () => ({
	select: (...args) => mockSelect(...args),
}));

jest.mock('@wordpress/block-editor', () => ({
	useBlockProps: (props) => props || {},
}));

jest.mock('@wordpress/components', () => ({
	Notice: ({ children }) => <div role="alert">{children}</div>,
	TextControl: ({ label, value, onChange }) => (
		<label>
			{label}
			<input value={value} onChange={(e) => onChange(e.target.value)} />
		</label>
	),
}));

let mockUuidCounter = 0;
jest.mock('fair-events-shared', () => ({
	generateUuid: () => `generated-uuid-${++mockUuidCounter}`,
}));

let capturedSettings;
jest.mock('@wordpress/blocks', () => ({
	registerBlockType: (name, settings) => {
		capturedSettings = settings;
	},
}));

/**
 * Wire up mockSelect so the imperative `select('core/block-editor')` calls
 * in index.js see a fake flat block list.
 *
 * @param {Array} blocks Fake blocks: `{ clientId, name, blockId }`.
 */
function mockBlockEditorStore(blocks) {
	mockSelect.mockImplementation((store) => {
		if (store !== 'core/block-editor') {
			return {};
		}
		return {
			getClientIdsWithDescendants: () => blocks.map((b) => b.clientId),
			getBlockName: (clientId) =>
				blocks.find((b) => b.clientId === clientId)?.name,
			getBlockAttributes: (clientId) => ({
				blockId: blocks.find((b) => b.clientId === clientId)?.blockId,
			}),
		};
	});
}

describe('Simple Payment Edit', () => {
	let Edit;

	beforeAll(() => {
		require('../index.js');
		Edit = capturedSettings.edit;
	});

	beforeEach(() => {
		mockUuidCounter = 0;
	});

	afterEach(() => {
		delete window.fairPaymentsConnector;
	});

	const baseAttributes = {
		blockId: '',
		amount: '10',
		currency: 'EUR',
		description: '',
	};

	const renderEdit = (
		attributes = {},
		setAttributes = () => {},
		clientId = 'block-1'
	) =>
		render(
			<Edit
				attributes={{ ...baseAttributes, ...attributes }}
				setAttributes={setAttributes}
				clientId={clientId}
			/>
		);

	it('assigns a fresh id and shows the missing-id notice when blockId is empty', () => {
		mockBlockEditorStore([
			{
				clientId: 'block-1',
				name: 'fair-payment/simple-payment',
				blockId: '',
			},
		]);
		const setAttributes = jest.fn();
		renderEdit({ blockId: '' }, setAttributes);

		expect(setAttributes).toHaveBeenCalledWith({
			blockId: 'generated-uuid-1',
		});
		expect(screen.getByRole('alert')).toHaveTextContent(
			/missing an identifier/
		);
	});

	it('reassigns the id and shows the duplicate notice when an earlier block already owns it', () => {
		mockBlockEditorStore([
			{
				clientId: 'block-1',
				name: 'fair-payment/simple-payment',
				blockId: 'shared-id',
			},
			{
				clientId: 'block-2',
				name: 'fair-payment/simple-payment',
				blockId: 'shared-id',
			},
		]);
		const setAttributes = jest.fn();
		renderEdit({ blockId: 'shared-id' }, setAttributes, 'block-2');

		expect(setAttributes).toHaveBeenCalledWith({
			blockId: 'generated-uuid-1',
		});
		expect(screen.getByRole('alert')).toHaveTextContent(
			/shared its identifier/
		);
	});

	it('leaves an already-unique id untouched and shows no notice', () => {
		mockBlockEditorStore([
			{
				clientId: 'block-1',
				name: 'fair-payment/simple-payment',
				blockId: 'unique-id',
			},
		]);
		const setAttributes = jest.fn();
		renderEdit({ blockId: 'unique-id' }, setAttributes, 'block-1');

		expect(setAttributes).not.toHaveBeenCalledWith(
			expect.objectContaining({ blockId: expect.anything() })
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('does not treat an earlier block with a different id as a duplicate', () => {
		mockBlockEditorStore([
			{
				clientId: 'block-1',
				name: 'fair-payment/simple-payment',
				blockId: 'other-id',
			},
			{
				clientId: 'block-2',
				name: 'fair-payment/simple-payment',
				blockId: 'my-id',
			},
		]);
		const setAttributes = jest.fn();
		renderEdit({ blockId: 'my-id' }, setAttributes, 'block-2');

		expect(setAttributes).not.toHaveBeenCalledWith(
			expect.objectContaining({ blockId: expect.anything() })
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});
});
