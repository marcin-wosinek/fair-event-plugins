<?php
/**
 * Fake Meetup event pages for the URL lookup tests (#2124).
 *
 * POST /fair-events/v1/lookup-url fetches the page over wp_safe_remote_get().
 * Requests for the fixture-only Meetup groups below are answered here in
 * `pre_http_request`, so the real fetch, parse and Meetup fallback run
 * offline against the captured page of event 317238692:
 *
 *   - /fair-e2e-meetup/events/317238692/          -> the captured page.
 *   - /fair-e2e-meetup-embedded/events/317238692/ -> the same page without
 *                                                    its SportsEvent JSON-LD,
 *                                                    so only the embedded
 *                                                    event data remains.
 *   - /fair-e2e-meetup-blocked/events/317238692/  -> 403, as when Meetup
 *                                                    refuses automated access.
 *
 * Any other Meetup URL passes through unchanged.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( false !== $preempt ) {
			return $preempt;
		}

		$host = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
		$path = (string) wp_parse_url( $url, PHP_URL_PATH );
		if ( 'www.meetup.com' !== $host
			|| ! preg_match( '#^/(fair-e2e-meetup(?:-embedded|-blocked)?)/events/317238692/?$#', $path, $m ) ) {
			return $preempt;
		}

		$respond = static function ( $code, $body ) {
			return array(
				'headers'  => array( 'content-type' => 'text/html; charset=utf-8' ),
				'body'     => $body,
				'response' => array(
					'code'    => $code,
					'message' => '',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		};

		if ( 'fair-e2e-meetup-blocked' === $m[1] ) {
			return $respond( 403, '<html><body>Forbidden</body></html>' );
		}

		$fixture = WP_PLUGIN_DIR . '/fair-events/__tests__/fixtures/meetup/event-page-317238692.html';
		$html    = is_readable( $fixture ) ? file_get_contents( $fixture ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
		if ( false === $html ) {
			return new WP_Error( 'fair_e2e_meetup_fixture_missing', 'Meetup page fixture not found.' );
		}

		if ( 'fair-e2e-meetup-embedded' === $m[1] ) {
			$html = preg_replace(
				'#<script type="application/ld\+json"[^>]*>\{"@context":"https://schema.org","@type":"SportsEvent".*?</script>#s',
				'',
				$html
			);
		}

		return $respond( 200, $html );
	},
	10,
	3
);
