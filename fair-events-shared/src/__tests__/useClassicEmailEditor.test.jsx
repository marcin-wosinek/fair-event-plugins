/**
 * @jest-environment jsdom
 *
 * Tests for the shared classic email editor lifecycle (#2232): visual edits,
 * Code-view reads without events, the textarea fallback, external drafts,
 * current callbacks, read-only transitions including a delayed TinyMCE
 * initialization, cleanup, and isolation between two editors.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from '@wordpress/element';
import useClassicEmailEditor from '../useClassicEmailEditor.js';

const Harness = forwardRef( function Harness(
	{ id, value, onChange, disabled = false },
	ref
) {
	const { textareaRef, read, emit, getVisualEditor } = useClassicEmailEditor(
		{ id, value, onChange, disabled }
	);
	useImperativeHandle( ref, () => ( { read, emit, getVisualEditor } ) );
	return (
		<>
			<label htmlFor={ id }>{ id }</label>
			<textarea
				id={ id }
				ref={ textareaRef }
				defaultValue={ value }
				onChange={ emit }
				disabled={ disabled }
			/>
		</>
	);
} );

/**
 * Minimal stand-in for `wp.editor` + `tinymce`, keyed by editor ID. Each
 * instance loads its textarea's content when it initializes, like TinyMCE.
 *
 * @param {Object}  options          Options.
 * @param {boolean} options.deferred Whether `init` waits for `ready( id )`.
 * @return {Object} Controls for the fake.
 */
function installEditor( { deferred = false } = {} ) {
	const instances = {};

	const create = ( id, settings ) => {
		const handlers = {};
		let content = '';
		const instance = {
			hidden: false,
			mode: 'design',
			initialized: false,
			isHidden: () => instance.hidden,
			getContent: () => content,
			setContent: jest.fn( ( next ) => {
				content = next;
			} ),
			setMode: jest.fn( ( mode ) => {
				instance.mode = mode;
			} ),
			on: ( names, handler ) => {
				names.split( ' ' ).forEach( ( name ) => {
					( handlers[ name ] = handlers[ name ] || [] ).push(
						handler
					);
				} );
			},
			fire: ( name ) =>
				( handlers[ name ] || [] ).forEach( ( handler ) => handler() ),
			// The user typing in the visual editor.
			type: ( next ) => {
				content = next;
				instance.fire( 'keyup' );
			},
			// Code view: textarea edits that fire no event.
			showCode: () => {
				instance.hidden = true;
			},
			init: () => {
				// Whatever was set before initialization does not survive it.
				content = document.getElementById( id ).value;
				instance.mode = 'design';
				instance.initialized = true;
				instance.fire( 'init' );
			},
		};
		settings.tinymce.setup( instance );
		instances[ id ] = instance;
		if ( ! deferred ) {
			instance.init();
		}
	};

	window.tinymce = { get: ( id ) => instances[ id ] || null };
	window.wp = {
		editor: {
			initialize: jest.fn( create ),
			remove: jest.fn( ( id ) => {
				delete instances[ id ];
			} ),
		},
	};

	return {
		get: ( id ) => instances[ id ],
		ready: ( id ) => act( () => instances[ id ].init() ),
	};
}

beforeEach( () => {
	delete window.wp;
	delete window.tinymce;
} );

test( 'mounts the classic editor with the existing toolbar', () => {
	installEditor();
	render( <Harness id="a" value="" onChange={ jest.fn() } /> );

	expect( window.wp.editor.initialize ).toHaveBeenCalledWith(
		'a',
		expect.objectContaining( {
			quicktags: true,
			mediaButtons: false,
			tinymce: expect.objectContaining( {
				toolbar1:
					'bold,italic,bullist,numlist,link,unlink,removeformat',
				plugins: 'lists,link',
				branding: false,
				menubar: false,
				statusbar: false,
				add_form_submit_trigger: false,
			} ),
		} )
	);
} );

test( 'reports visual edits and reads Code-view edits without an event', () => {
	const fake = installEditor();
	const onChange = jest.fn();
	const ref = { current: null };
	render( <Harness ref={ ref } id="a" value="" onChange={ onChange } /> );

	act( () => fake.get( 'a' ).type( '<p>Visual</p>' ) );
	expect( onChange ).toHaveBeenLastCalledWith( '<p>Visual</p>' );
	expect( ref.current.getVisualEditor() ).toBe( fake.get( 'a' ) );

	fake.get( 'a' ).showCode();
	screen.getByLabelText( 'a' ).value = '<p>Code</p>';
	expect( ref.current.getVisualEditor() ).toBeNull();
	expect( ref.current.read() ).toBe( '<p>Code</p>' );
} );

test( 'falls back to the textarea without the editor scripts', () => {
	const onChange = jest.fn();
	const ref = { current: null };
	render(
		<Harness ref={ ref } id="a" value="<p>A</p>" onChange={ onChange } />
	);

	const field = screen.getByLabelText( 'a' );
	expect( field ).toHaveValue( '<p>A</p>' );
	fireEvent.change( field, { target: { value: '<p>B</p>' } } );
	expect( onChange ).toHaveBeenLastCalledWith( '<p>B</p>' );
	expect( ref.current.read() ).toBe( '<p>B</p>' );
	expect( ref.current.getVisualEditor() ).toBeNull();
} );

test( 'writes externally replaced and cleared drafts into the editor, but not its own edits', () => {
	const fake = installEditor();
	const onChange = jest.fn();
	const { rerender } = render(
		<Harness id="a" value="<p>Old</p>" onChange={ onChange } />
	);
	const editor = fake.get( 'a' );
	editor.setContent.mockClear();

	act( () => editor.type( '<p>Typed</p>' ) );
	rerender( <Harness id="a" value="<p>Typed</p>" onChange={ onChange } /> );
	expect( editor.setContent ).not.toHaveBeenCalled();

	rerender( <Harness id="a" value="<p>Reused</p>" onChange={ onChange } /> );
	expect( editor.getContent() ).toBe( '<p>Reused</p>' );
	expect( screen.getByLabelText( 'a' ) ).toHaveValue( '<p>Reused</p>' );

	rerender( <Harness id="a" value="" onChange={ onChange } /> );
	expect( editor.getContent() ).toBe( '' );
	expect( screen.getByLabelText( 'a' ) ).toHaveValue( '' );
	expect( window.wp.editor.initialize ).toHaveBeenCalledTimes( 1 );
} );

test( 'calls the newest onChange without reinitializing the editor', () => {
	const fake = installEditor();
	const first = jest.fn();
	const second = jest.fn();
	const { rerender } = render(
		<Harness id="a" value="" onChange={ first } />
	);
	rerender( <Harness id="a" value="" onChange={ second } /> );

	act( () => fake.get( 'a' ).type( '<p>Hi</p>' ) );
	expect( first ).not.toHaveBeenCalled();
	expect( second ).toHaveBeenCalledWith( '<p>Hi</p>' );
	expect( window.wp.editor.initialize ).toHaveBeenCalledTimes( 1 );
	expect( window.wp.editor.remove ).not.toHaveBeenCalled();
} );

test( 'toggles read-only mode with disabled', () => {
	const fake = installEditor();
	const { rerender } = render(
		<Harness id="a" value="" onChange={ jest.fn() } />
	);
	rerender( <Harness id="a" value="" onChange={ jest.fn() } disabled /> );
	expect( fake.get( 'a' ).mode ).toBe( 'readonly' );
	rerender( <Harness id="a" value="" onChange={ jest.fn() } /> );
	expect( fake.get( 'a' ).mode ).toBe( 'design' );
} );

test( 'applies the latest draft and lock state when TinyMCE initializes late', () => {
	const fake = installEditor( { deferred: true } );
	const onChange = jest.fn();
	const { rerender } = render(
		<Harness id="a" value="" onChange={ onChange } />
	);
	expect( fake.get( 'a' ).initialized ).toBe( false );

	rerender(
		<Harness id="a" value="<p>Loaded</p>" onChange={ onChange } disabled />
	);
	fake.ready( 'a' );

	expect( fake.get( 'a' ).getContent() ).toBe( '<p>Loaded</p>' );
	expect( fake.get( 'a' ).mode ).toBe( 'readonly' );
	expect( onChange ).not.toHaveBeenCalled();
} );

test( 'removes its own editor instance on unmount and ID change', () => {
	installEditor();
	const { rerender, unmount } = render(
		<Harness id="a" value="" onChange={ jest.fn() } />
	);
	rerender( <Harness id="b" value="" onChange={ jest.fn() } /> );
	expect( window.wp.editor.remove ).toHaveBeenCalledWith( 'a' );
	expect( window.wp.editor.initialize ).toHaveBeenLastCalledWith(
		'b',
		expect.anything()
	);

	unmount();
	expect( window.wp.editor.remove ).toHaveBeenLastCalledWith( 'b' );
	expect( window.wp.editor.remove ).toHaveBeenCalledTimes( 2 );
} );

test( 'keeps two editors apart', () => {
	const fake = installEditor();
	const onA = jest.fn();
	const onB = jest.fn();
	const refA = { current: null };
	const refB = { current: null };
	const Pair = ( { showB = true, valueA = '<p>A</p>' } ) => (
		<>
			<Harness ref={ refA } id="a" value={ valueA } onChange={ onA } />
			{ showB && (
				<Harness
					ref={ refB }
					id="b"
					value="<p>B</p>"
					onChange={ onB }
				/>
			) }
		</>
	);
	const { rerender } = render( <Pair /> );

	act( () => fake.get( 'b' ).type( '<p>B2</p>' ) );
	expect( onB ).toHaveBeenLastCalledWith( '<p>B2</p>' );
	expect( onA ).not.toHaveBeenCalled();
	expect( refA.current.read() ).toBe( '<p>A</p>' );
	expect( refB.current.read() ).toBe( '<p>B2</p>' );

	rerender( <Pair valueA="<p>A2</p>" /> );
	expect( fake.get( 'a' ).getContent() ).toBe( '<p>A2</p>' );
	expect( fake.get( 'b' ).getContent() ).toBe( '<p>B2</p>' );

	rerender( <Pair showB={ false } valueA="<p>A2</p>" /> );
	expect( window.wp.editor.remove ).toHaveBeenCalledTimes( 1 );
	expect( window.wp.editor.remove ).toHaveBeenCalledWith( 'b' );
	act( () => fake.get( 'a' ).type( '<p>A3</p>' ) );
	expect( onA ).toHaveBeenLastCalledWith( '<p>A3</p>' );
	expect( refA.current.read() ).toBe( '<p>A3</p>' );
} );
