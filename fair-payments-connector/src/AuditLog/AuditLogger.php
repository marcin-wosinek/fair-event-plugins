<?php
/**
 * Audit logger for Fair Payments Connector settings and connection changes
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\AuditLog;

use FairPaymentsConnector\Database\AuditLogRepository;

defined( 'WPINC' ) || die;

/**
 * Writes audit log entries with built-in redaction and no-op suppression.
 *
 * Values are retained (old_value/new_value stored) only for keys on the
 * explicit SAFE_SETTING_KEYS allowlist. Every other key is recorded with
 * old_value/new_value left NULL and is_protected=1 — the row still proves
 * *that* a protected setting changed, but never carries its value, so this
 * table can never become a source from which credentials are recoverable.
 */
class AuditLogger {

	/**
	 * Setting keys safe to retain old/new values for. Everything else
	 * (access/refresh tokens, API credentials, etc.) is redacted.
	 *
	 * `bundled-translations` is the key inside the fair_payment_features
	 * option, not an option name of its own.
	 */
	const SAFE_SETTING_KEYS = array(
		'fair_payment_mode',
		'fair_payment_currency',
		'fair_payment_disable_banktransfer_near_date',
		'fair_payment_banktransfer_threshold_days',
		'bundled-translations',
	);

	/**
	 * Record a change to a single setting. No-op if the value did not
	 * actually change.
	 *
	 * @param string   $setting_key   Setting/option key.
	 * @param mixed    $old_value     Previous value.
	 * @param mixed    $new_value     New value.
	 * @param string   $reason        Administrator-supplied reason.
	 * @param int|null $actor_user_id Acting user ID, or null for the system.
	 * @return bool|null True on success, false on storage failure, null when
	 *                    the value did not change (nothing was written).
	 */
	public static function record_setting_change( $setting_key, $old_value, $new_value, $reason, $actor_user_id = null ) {
		if ( self::stringify( $old_value ) === self::stringify( $new_value ) ) {
			return null;
		}

		$safe  = in_array( $setting_key, self::SAFE_SETTING_KEYS, true );
		$actor = self::resolve_actor( $actor_user_id );

		return ( new AuditLogRepository() )->insert(
			array_merge(
				$actor,
				array(
					'action'       => 'setting_changed',
					'setting_key'  => $setting_key,
					'old_value'    => $safe ? self::stringify( $old_value ) : null,
					'new_value'    => $safe ? self::stringify( $new_value ) : null,
					'is_protected' => $safe ? 0 : 1,
					'reason'       => $reason,
					'context'      => null,
				)
			)
		);
	}

	/**
	 * Record a non-setting action (connect, reconnect, disconnect, token
	 * refresh, connection loss, ...) attributed to a WordPress user.
	 *
	 * @param string   $action        Action taxonomy value.
	 * @param string   $reason        Administrator-supplied (or generated) reason.
	 * @param int|null $actor_user_id Acting user ID, or null for the system.
	 * @param array    $context       Optional extra non-sensitive context. Any key
	 *                                that looks credential-like is dropped as a
	 *                                defense-in-depth measure — see sanitize_context().
	 * @return bool True on success, false on storage failure.
	 */
	public static function record_action( $action, $reason, $actor_user_id = null, array $context = array() ) {
		$actor = self::resolve_actor( $actor_user_id );

		return ( new AuditLogRepository() )->insert(
			array_merge(
				$actor,
				array(
					'action'       => $action,
					'setting_key'  => null,
					'old_value'    => null,
					'new_value'    => null,
					'is_protected' => 0,
					'reason'       => $reason,
					'context'      => empty( $context ) ? null : wp_json_encode( self::sanitize_context( $context ) ),
				)
			)
		);
	}

	/**
	 * Record an action performed automatically by the plugin (no logged-in
	 * administrator initiated it directly), e.g. a background token refresh.
	 *
	 * @param string $action  Action taxonomy value.
	 * @param string $reason  Generated reason describing the automatic operation.
	 * @param array  $context Optional extra non-sensitive context.
	 * @return bool True on success, false on storage failure.
	 */
	public static function record_system_action( $action, $reason, array $context = array() ) {
		return self::record_action( $action, $reason, null, $context );
	}

	/**
	 * Resolve the actor snapshot for a WordPress user, or the system.
	 *
	 * @param int|null $actor_user_id Acting user ID, or null for the system.
	 * @return array{actor_user_id: int|null, actor_display_name: string|null, actor_login: string|null}
	 */
	private static function resolve_actor( $actor_user_id ) {
		if ( empty( $actor_user_id ) ) {
			return array(
				'actor_user_id'      => null,
				'actor_display_name' => null,
				'actor_login'        => null,
			);
		}

		$user = get_userdata( $actor_user_id );

		return array(
			'actor_user_id'      => (int) $actor_user_id,
			'actor_display_name' => $user ? $user->display_name : null,
			'actor_login'        => $user ? $user->user_login : null,
		);
	}

	/**
	 * Normalize a value for storage/comparison. Scalars are cast to string;
	 * arrays/objects are JSON-encoded so equal values compare equal
	 * regardless of representation.
	 *
	 * @param mixed $value Value to normalize.
	 * @return string|null
	 */
	private static function stringify( $value ) {
		if ( null === $value ) {
			return null;
		}
		if ( is_bool( $value ) ) {
			return $value ? '1' : '0';
		}
		if ( is_scalar( $value ) ) {
			return (string) $value;
		}
		return wp_json_encode( $value );
	}

	/**
	 * Drop any context key that looks credential-like and any non-scalar
	 * value, as defense in depth on top of callers only ever passing
	 * deliberately-chosen, non-sensitive context fields.
	 *
	 * @param array $context Raw context.
	 * @return array Sanitized context.
	 */
	private static function sanitize_context( array $context ) {
		$safe = array();
		foreach ( $context as $key => $value ) {
			if ( preg_match( '/token|secret|password|credential|key/i', (string) $key ) ) {
				continue;
			}
			if ( is_scalar( $value ) || null === $value ) {
				$safe[ $key ] = $value;
			}
		}
		return $safe;
	}
}
