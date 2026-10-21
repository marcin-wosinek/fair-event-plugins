<?php
/**
 * Sanitized snapshots of outgoing Meta Conversions API requests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/**
 * Turns the final request body into a bounded, flat list of fields that is
 * safe to store and show to administrators.
 *
 * Every field keeps its path, type and, for lists and objects, its size, so
 * absent, null, empty and redacted values stay distinguishable. A value is
 * kept only when its path is on {@see VISIBLE}; everything else — the access
 * token, the Test Events code, matching identifiers, event and order IDs,
 * unknown fields — is redacted before the snapshot leaves this class, with a
 * validation result for recognized identifiers instead of the value.
 */
class RequestDiagnostics {
	/** Snapshot format; bump when the shape changes. */
	public const VERSION = 1;

	/** Most bytes one JSON-encoded snapshot may take. */
	public const MAX_BYTES = 32768;

	/** Most fields one snapshot lists. */
	public const MAX_FIELDS = 300;

	/** Deepest nesting walked; deeper values are listed as truncated. */
	public const MAX_DEPTH = 8;

	/** Longest visible string value kept. */
	public const MAX_STRING = 200;

	/**
	 * Paths whose values are shown, with how each is validated. `[]` stands
	 * for any list index. A value that fails its rule is redacted.
	 */
	private const VISIBLE = array(
		'data[].event_name'                    => 'name',
		'data[].event_time'                    => 'integer',
		'data[].action_source'                 => 'name',
		'data[].custom_data.value'             => 'number',
		'data[].custom_data.currency'          => 'currency',
		'data[].custom_data.payment_mode'      => 'payment_mode',
		'data[].custom_data.action'            => 'name',
		'data[].custom_data.post_id'           => 'integer',
		'data[].custom_data.event_date_id'     => 'integer',
		'data[].custom_data.content_name'      => 'text',
		'data[].custom_data.content_ids[]'     => 'content_id',
		'data[].custom_data.event_start_date'  => 'date',
		'data[].custom_data.content_type'      => 'name',
		'data[].custom_data.num_items'         => 'integer',
		'data[].data_processing_options[]'     => 'name',
		'data[].data_processing_options_state' => 'integer',
	);

	/** User data fields that carry a Meta browser identifier. */
	private const META_IDENTIFIERS = array( 'fbp', 'fbc' );

	/** User data fields Meta expects unhashed. */
	private const UNHASHED_USER_DATA = array( 'fbp', 'fbc', 'client_user_agent', 'client_ip_address' );

	/**
	 * Snapshot a request just before it is sent. Never throws: a failure
	 * yields null, so diagnostics cannot stop delivery.
	 *
	 * @param array  $body        Final request body, credentials included.
	 * @param string $dataset_id  Destination dataset ID.
	 * @param string $api_version Graph API version.
	 * @return array|null
	 */
	public static function capture( $body, $dataset_id, $api_version ) {
		try {
			$secrets  = self::secrets( $body );
			$fields   = array();
			$budget   = self::MAX_BYTES - 1024;
			$complete = self::walk( $body, '', '', 0, $secrets, $fields, $budget );
			return array(
				'version'          => self::VERSION,
				'method'           => 'POST',
				'content_type'     => 'application/json',
				'api_version'      => (string) $api_version,
				'dataset_id'       => preg_match( '/^\d{1,32}$/', (string) $dataset_id ) ? (string) $dataset_id : '',
				'test_events_code' => isset( $body['test_event_code'] ) && '' !== $body['test_event_code'],
				'fields'           => $fields,
				'truncated'        => ! $complete || in_array( true, array_column( $fields, 'truncated' ), true ),
			);
		} catch ( \Throwable $e ) {
			return null;
		}
	}

	/**
	 * Every value of a body that a snapshot redacts and that is long enough
	 * to recognize, so Meta's messages echoing one can be redacted too.
	 *
	 * @param mixed  $value Body, or a part of it.
	 * @param string $path  Normalized path of `$value`.
	 * @return string[]
	 */
	public static function secrets( $value, $path = '' ) {
		if ( is_array( $value ) ) {
			$found = array();
			foreach ( $value as $key => $child ) {
				$found = array_merge( $found, self::secrets( $child, self::child_path( $path, $key, $value ) ) );
			}
			return array_values( array_unique( $found ) );
		}
		if ( is_string( $value ) && strlen( $value ) >= 4 && ! isset( self::VISIBLE[ $path ] ) ) {
			return array( $value );
		}
		return array();
	}

	/**
	 * Re-validate a stored snapshot before it is returned, keeping only the
	 * keys this class writes.
	 *
	 * @param mixed $snapshot Decoded snapshot.
	 * @return array|null
	 */
	public static function from_storage( $snapshot ) {
		if ( ! is_array( $snapshot ) || self::VERSION !== ( $snapshot['version'] ?? null ) || ! isset( $snapshot['fields'] ) || ! is_array( $snapshot['fields'] ) ) {
			return null;
		}
		$fields = array();
		foreach ( array_slice( $snapshot['fields'], 0, self::MAX_FIELDS ) as $field ) {
			$clean = self::stored_field( $field );
			if ( $clean ) {
				$fields[] = $clean;
			}
		}
		return array(
			'version'          => self::VERSION,
			'method'           => 'POST',
			'content_type'     => 'application/json',
			'api_version'      => preg_match( '/^v\d{1,3}\.\d{1,3}$/', (string) ( $snapshot['api_version'] ?? '' ) ) ? $snapshot['api_version'] : '',
			'dataset_id'       => preg_match( '/^\d{1,32}$/', (string) ( $snapshot['dataset_id'] ?? '' ) ) ? $snapshot['dataset_id'] : '',
			'test_events_code' => true === ( $snapshot['test_events_code'] ?? null ),
			'fields'           => $fields,
			'truncated'        => true === ( $snapshot['truncated'] ?? null ),
		);
	}

	/**
	 * List `$value` and its children into `$fields`.
	 *
	 * @param mixed  $value   Value.
	 * @param string $path    Display path, with list indexes.
	 * @param string $rule    Normalized path, with `[]` for list indexes.
	 * @param int    $depth   Nesting depth.
	 * @param array  $secrets Values never shown.
	 * @param array  $fields  Collected fields.
	 * @param int    $budget  Bytes left.
	 * @return bool Whether everything fit.
	 */
	private static function walk( $value, $path, $rule, $depth, $secrets, &$fields, &$budget ) {
		if ( '' !== $path ) {
			$field = self::field( $value, $path, $rule, $secrets );
			if ( $depth > self::MAX_DEPTH && is_array( $value ) ) {
				$field['truncated'] = true;
			}
			$size = strlen( (string) wp_json_encode( $field ) ) + 1;
			if ( count( $fields ) >= self::MAX_FIELDS || $size > $budget ) {
				return false;
			}
			$fields[] = $field;
			$budget  -= $size;
		}
		if ( ! is_array( $value ) || $depth > self::MAX_DEPTH ) {
			return true;
		}
		foreach ( $value as $key => $child ) {
			$child_path = '' === $path ? (string) $key : ( self::is_list( $value ) ? $path . '[' . $key . ']' : $path . '.' . $key );
			if ( ! self::walk( $child, $child_path, self::child_path( $rule, $key, $value ), $depth + 1, $secrets, $fields, $budget ) ) {
				return false;
			}
		}
		return true;
	}

	/** @param string $rule Parent's normalized path. @param int|string $key Key. @param array $container Parent. @return string */
	private static function child_path( $rule, $key, $container ) {
		if ( '' === $rule ) {
			return (string) $key;
		}
		return self::is_list( $container ) ? $rule . '[]' : $rule . '.' . $key;
	}

	/**
	 * One field's description.
	 *
	 * @param mixed  $value   Value.
	 * @param string $path    Display path.
	 * @param string $rule    Normalized path.
	 * @param array  $secrets Values never shown.
	 * @return array `path`, `type`, `state` and, depending on them, `count`,
	 *               `value`, `length`, `check`, `url` or `truncated`.
	 */
	private static function field( $value, $path, $rule, $secrets ) {
		$field = array(
			'path' => $path,
			'type' => self::type_of( $value ),
		);
		if ( is_array( $value ) ) {
			$field['count'] = count( $value );
			$field['state'] = 0 === $field['count'] ? 'empty' : 'structure';
			return $field;
		}
		if ( null === $value ) {
			$field['state'] = 'null';
			return $field;
		}
		if ( '' === $value ) {
			$field['state'] = 'empty';
			return $field;
		}
		if ( isset( self::VISIBLE[ $rule ] ) && self::allowed( $value, self::VISIBLE[ $rule ] ) && ! self::contains_secret( $value, $secrets ) ) {
			$field['state'] = 'value';
			if ( is_string( $value ) && self::length( $value ) > self::MAX_STRING ) {
				$field['value']     = function_exists( 'mb_substr' ) ? mb_substr( $value, 0, self::MAX_STRING ) : substr( $value, 0, self::MAX_STRING );
				$field['truncated'] = true;
			} else {
				$field['value'] = $value;
			}
			return $field;
		}
		$field['state'] = 'redacted';
		if ( is_string( $value ) ) {
			$field['length'] = self::length( $value );
			$check           = self::check( $value, $rule );
			if ( $check ) {
				$field['check'] = $check;
			}
			if ( 'data[].event_source_url' === $rule ) {
				$field['url'] = self::url_structure( $value );
			}
		}
		return $field;
	}

	/** @param array $value Array. @return bool Whether it encodes as a JSON list; `array_is_list()` needs PHP 8.1. */
	private static function is_list( $value ) {
		return array_keys( $value ) === range( 0, count( $value ) - 1 ) || array() === $value;
	}

	/** @param mixed $value Value. @return string JSON type name. */
	private static function type_of( $value ) {
		if ( is_array( $value ) ) {
			return self::is_list( $value ) ? 'array' : 'object';
		}
		if ( is_bool( $value ) ) {
			return 'boolean';
		}
		if ( is_int( $value ) ) {
			return 'integer';
		}
		if ( is_float( $value ) ) {
			return 'number';
		}
		return null === $value ? 'null' : 'string';
	}

	/** @param mixed $value Scalar. @param string $rule Rule from {@see VISIBLE}. @return bool */
	private static function allowed( $value, $rule ) {
		switch ( $rule ) {
			case 'integer':
				return is_int( $value );
			case 'number':
				return is_int( $value ) || is_float( $value );
			case 'name':
				return is_string( $value ) && (bool) preg_match( '/^[A-Za-z][A-Za-z0-9_]{0,63}$/', $value );
			case 'currency':
				return is_string( $value ) && (bool) preg_match( '/^[A-Z]{3}$/', $value );
			case 'payment_mode':
				return in_array( $value, array( 'test', 'live' ), true );
			case 'content_id':
				return is_string( $value ) && (bool) preg_match( '/^(?:[1-9]\d*|event-date:[1-9]\d*|fair-events-test-event)$/', $value );
			case 'date':
				return is_string( $value ) && (bool) preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value );
			case 'text':
				return is_string( $value ) && (bool) preg_match( '//u', $value ) && ! preg_match( '/[\x00-\x1F\x7F]/', $value );
		}
		return false;
	}

	/** @param mixed $value Scalar. @param string[] $secrets Values never shown. @return bool */
	private static function contains_secret( $value, $secrets ) {
		if ( ! is_string( $value ) ) {
			return false;
		}
		foreach ( $secrets as $secret ) {
			if ( false !== strpos( $value, $secret ) ) {
				return true;
			}
		}
		return (bool) preg_match( '/fb\.1\.\d{10,16}\.|\b[a-f0-9]{64}\b/i', $value );
	}

	/**
	 * What can be said about a redacted identifier without its value.
	 *
	 * @param string $value Value.
	 * @param string $rule  Normalized path.
	 * @return string|null `valid`/`invalid` for Meta browser identifiers,
	 *                     `sha256`/`not_sha256` for hashed user data, and
	 *                     `sha256`/`uuid`/`other` for event IDs.
	 */
	private static function check( $value, $rule ) {
		if ( preg_match( '/^data\[\]\.user_data\.([a-z_]+)(\[\])?$/', $rule, $match ) ) {
			if ( in_array( $match[1], self::META_IDENTIFIERS, true ) ) {
				return Conversions::valid_identifier( $value ) ? 'valid' : 'invalid';
			}
			if ( in_array( $match[1], self::UNHASHED_USER_DATA, true ) ) {
				return null;
			}
			return preg_match( '/^[a-f0-9]{64}$/', $value ) ? 'sha256' : 'not_sha256';
		}
		if ( 'data[].event_id' === $rule ) {
			if ( preg_match( '/^[a-f0-9]{64}$/', $value ) ) {
				return 'sha256';
			}
			return Conversions::valid_activation_id( $value ) ? 'uuid' : 'other';
		}
		return null;
	}

	/**
	 * The structure of a source URL: its scheme and host — the site's own —
	 * and only whether it has a path, query parameters or a fragment.
	 *
	 * @param string $url URL.
	 * @return array `origin`, `same_site`, `path`, `query` (parameter count) and `fragment`.
	 */
	private static function url_structure( $url ) {
		$parts = wp_parse_url( $url );
		$parts = is_array( $parts ) ? $parts : array();
		$host  = isset( $parts['host'] ) && preg_match( '/^[A-Za-z0-9.-]{1,253}$/', $parts['host'] ) ? strtolower( $parts['host'] ) : '';
		$home  = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
		$query = array();
		if ( isset( $parts['query'] ) ) {
			parse_str( $parts['query'], $query );
		}
		return array(
			'origin'    => $host && in_array( $parts['scheme'] ?? '', array( 'http', 'https' ), true ) ? $parts['scheme'] . '://' . $host . ( isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '' ) : '',
			'same_site' => '' !== $host && is_string( $home ) && strtolower( $home ) === $host,
			'path'      => isset( $parts['path'] ) && '' !== $parts['path'] && '/' !== $parts['path'],
			'query'     => count( $query ),
			'fragment'  => isset( $parts['fragment'] ),
		);
	}

	/** @param string $value Value. @return int Length in characters. */
	private static function length( $value ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value ) : strlen( $value );
	}

	/**
	 * @param mixed $field Stored field.
	 * @return array|null The field with only known keys and safe values.
	 */
	private static function stored_field( $field ) {
		$types  = array( 'string', 'integer', 'number', 'boolean', 'null', 'object', 'array' );
		$states = array( 'value', 'redacted', 'empty', 'null', 'structure' );
		if ( ! is_array( $field ) || ! is_string( $field['path'] ?? null ) || ! in_array( $field['type'] ?? null, $types, true ) || ! in_array( $field['state'] ?? null, $states, true ) ) {
			return null;
		}
		$clean = array(
			'path'  => substr( $field['path'], 0, 200 ),
			'type'  => $field['type'],
			'state' => $field['state'],
		);
		if ( isset( $field['count'] ) && is_int( $field['count'] ) ) {
			$clean['count'] = $field['count'];
		}
		if ( 'value' === $field['state'] && array_key_exists( 'value', $field ) && is_scalar( $field['value'] ) ) {
			$clean['value'] = $field['value'];
		}
		if ( isset( $field['length'] ) && is_int( $field['length'] ) ) {
			$clean['length'] = $field['length'];
		}
		if ( isset( $field['check'] ) && in_array( $field['check'], array( 'valid', 'invalid', 'sha256', 'not_sha256', 'uuid', 'other' ), true ) ) {
			$clean['check'] = $field['check'];
		}
		if ( isset( $field['url'] ) && is_array( $field['url'] ) ) {
			$clean['url'] = array(
				'origin'    => preg_match( '#^https?://[a-z0-9.-]+(:\d+)?$#', (string) ( $field['url']['origin'] ?? '' ) ) ? $field['url']['origin'] : '',
				'same_site' => true === ( $field['url']['same_site'] ?? null ),
				'path'      => true === ( $field['url']['path'] ?? null ),
				'query'     => (int) ( $field['url']['query'] ?? 0 ),
				'fragment'  => true === ( $field['url']['fragment'] ?? null ),
			);
		}
		if ( true === ( $field['truncated'] ?? null ) ) {
			$clean['truncated'] = true;
		}
		return $clean;
	}
}
