<?php
/**
 * Ticket Availability Resolver
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Single seam fair-audience's signup flow uses to reach ticket-type
 * time-based availability: prefers `FairEvents\Services\TicketAvailability`
 * (the shared authority added in fair-events, issue #1581) and otherwise
 * falls back to a local check, mirroring SignupPriceResolver's cross-version
 * compatibility pattern (issue #1421).
 *
 * Reused for both signup-form display filtering and submission validation so
 * the legacy signup form can never display a ticket type that its own
 * controller then rejects because of a server/site timezone difference.
 */
class TicketAvailabilityResolver {

	/**
	 * Attempt a call into `FairEvents\Services\TicketAvailability`,
	 * degrading instead of fataling when fair-events predates the shared
	 * service or the two plugins' interfaces have drifted out of sync: a
	 * `method_exists()` guard catches a build missing the method entirely
	 * (`class_exists()` alone would stay true and the call would fatal with
	 * "Call to undefined method"), and a `try`/`catch` around the actual call
	 * additionally catches a build whose method exists but takes an
	 * incompatible signature, which `method_exists()` can't detect on its own.
	 *
	 * @param string $method Method name on TicketAvailability.
	 * @param array  $args   Positional arguments to call it with.
	 * @return array{ok: bool, value: mixed} `ok: true` with the real result,
	 *                                       or `ok: false` for the caller to
	 *                                       apply its own fallback.
	 */
	private static function call_shared( $method, array $args ) {
		$class = \FairEvents\Services\TicketAvailability::class;

		if ( method_exists( $class, $method ) ) {
			try {
				return array(
					'ok'    => true,
					'value' => call_user_func_array( array( $class, $method ), $args ),
				);
			} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement.DetectedCatch -- intentional: version mismatch despite the method existing (e.g. an incompatible signature); fall through to the warning and let the caller apply its fallback.
				unset( $e );
			}
		}

		if ( class_exists( $class ) && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( "FairAudience: fair-events' TicketAvailability::{$method}() is missing or incompatible (version mismatch); falling back." );
		}

		return array(
			'ok'    => false,
			'value' => null,
		);
	}

	/**
	 * Whether a ticket type remains enabled: not manually disabled, and its
	 * scheduled disable_at boundary (if any) not yet reached.
	 *
	 * The fallback below uses `current_time( 'mysql' )` — WordPress site
	 * time — and exactly mirrors
	 * `TicketAvailability::is_ticket_type_enabled()`, never PHP's
	 * server-time `time()`/`strtotime()`, so a boundary decision can never
	 * disagree between the fair-events and fair-audience signup paths.
	 *
	 * @param object $ticket_type Ticket type object exposing `disabled`/`disable_at`.
	 * @return bool Whether the type remains enabled.
	 */
	public static function is_ticket_type_enabled( $ticket_type ) {
		$result = self::call_shared( 'is_ticket_type_enabled', array( $ticket_type ) );
		if ( $result['ok'] ) {
			return $result['value'];
		}

		$now = current_time( 'mysql' );
		return empty( $ticket_type->disabled )
			&& ( empty( $ticket_type->disable_at ) || $ticket_type->disable_at > $now );
	}
}
