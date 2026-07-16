/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

// ServerSideRender hits the REST API for a live render; stub it to a marker
// so we can render the block in isolation.
jest.mock(
	'@wordpress/server-side-render',
	() => () => <div data-testid="ssr" />,
	{ virtual: true }
);

const mockUseSelect = jest.fn();
jest.mock('@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{ useSelect: (...args) => mockUseSelect(...args) },
		{
			get(target, prop) {
				if (prop in target) return target[prop];
				return stub;
			},
		}
	);
});

// useBlockProps/useInnerBlocksProps need the editor's block context, which
// jsdom doesn't provide; stub them to plain markers so we can assert on the
// questions region without a full editor.
jest.mock('@wordpress/block-editor', () => ({
	useBlockProps: () => ({}),
	useInnerBlocksProps: () => ({ 'data-testid': 'inner-blocks' }),
	InspectorControls: ({ children }) => children,
	InnerBlocks: Object.assign(() => null, {
		Content: () => null,
		ButtonBlockAppender: () => null,
	}),
}));

// Capture the block settings passed to registerBlockType so the edit
// function can be rendered directly, without a live block registry.
let capturedSettings;
jest.mock('@wordpress/blocks', () => ({
	registerBlockType: (name, settings) => {
		capturedSettings = settings;
	},
}));

describe('Event Signup EditComponent', () => {
	let Edit;

	beforeAll(() => {
		require('../editor.js');
		Edit = capturedSettings.edit;
	});

	const renderEdit = (isFairFormActive) => {
		mockUseSelect.mockReturnValue(isFairFormActive);
		return render(
			<Edit
				attributes={{ submitButtonText: 'Get Tickets' }}
				setAttributes={() => {}}
			/>
		);
	};

	it('shows the custom-questions region when fair-form is active', () => {
		renderEdit(true);

		expect(screen.getByTestId('ssr')).toBeInTheDocument();
		expect(screen.getByTestId('inner-blocks')).toBeInTheDocument();
		expect(screen.getByText('Custom questions')).toBeInTheDocument();
	});

	it('hides the custom-questions region when fair-form is inactive', () => {
		renderEdit(false);

		expect(screen.getByTestId('ssr')).toBeInTheDocument();
		expect(screen.queryByTestId('inner-blocks')).toBeNull();
		expect(screen.queryByText('Custom questions')).toBeNull();
	});
});
