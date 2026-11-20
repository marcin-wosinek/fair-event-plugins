import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SetupGuide from '../SetupGuide.js';

it( 'guides manual setup without implying production readiness', () => {
	render( <SetupGuide /> );
	expect( screen.getAllByRole( 'listitem' ) ).toHaveLength( 5 );
	for ( const text of [
		/Connect on WhatsApp/,
		/test senders can message only/,
		/Phone Number ID is not/,
		/system user/,
		/neither the access token nor the App Secret/,
		/Validation only checks/,
		/no conversation inbox/,
	] ) {
		expect( screen.getByText( text ) ).toBeInTheDocument();
	}
	expect(
		screen.getByRole( 'link', { name: /Setup, credential rotation/ } )
	).toHaveAttribute(
		'href',
		'https://github.com/marcin-wosinek/fair-event-plugins/blob/main/docs/whatsapp-cloud-api-setup.md'
	);
	expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
} );
