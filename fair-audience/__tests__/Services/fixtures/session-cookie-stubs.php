<?php
/**
 * Stubs for testing FairEventsShared\Security\SessionCookie and the session
 * services built on it.
 *
 * `setcookie()` and `headers_sent()` are PHP built-ins, so they are stubbed in
 * the helper's namespace: unqualified calls there resolve to these first.
 * Tests read `$GLOBALS['_fair_test_setcookie_calls']` and control
 * `_fair_test_headers_sent`, `_fair_test_setcookie_result` and
 * `_fair_test_is_ssl` (read by the bootstrap's is_ssl() stub).
 *
 * @package FairAudience
 */

namespace FairEventsShared\Security;

if ( ! function_exists( __NAMESPACE__ . '\\setcookie' ) ) {
	/**
	 * Record a setcookie() call instead of sending a header.
	 *
	 * @param string $name    Cookie name.
	 * @param string $value   Cookie value.
	 * @param array  $options Cookie options.
	 * @return bool The configured result, true by default.
	 */
	function setcookie( $name, $value, $options ) {
		$GLOBALS['_fair_test_setcookie_calls'][] = array(
			'name'    => $name,
			'value'   => $value,
			'options' => $options,
		);
		return isset( $GLOBALS['_fair_test_setcookie_result'] ) ? $GLOBALS['_fair_test_setcookie_result'] : true;
	}
}

if ( ! function_exists( __NAMESPACE__ . '\\headers_sent' ) ) {
	/**
	 * Report whether a test marked headers as sent.
	 *
	 * @return bool
	 */
	function headers_sent() {
		return ! empty( $GLOBALS['_fair_test_headers_sent'] );
	}
}
