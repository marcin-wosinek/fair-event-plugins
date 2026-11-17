<?php
/**
 * Allowlisted error-tracker events for the Mollie OAuth flows
 *
 * @package FairPlatform
 */

namespace FairPlatform\Monitoring;

use Sentry\Event;
use Sentry\ExceptionDataBag;
use Sentry\ExceptionMechanism;
use Sentry\Frame;
use Sentry\Severity;
use Sentry\Stacktrace;

defined( 'ABSPATH' ) || die;

/**
 * Builds the only events the OAuth proxy sends to the error tracker (#2290).
 *
 * Tokens, authorization codes, client secrets and state values flow through
 * these requests, so an event carries nothing taken from a request, a user,
 * a provider response or an exception message. It holds fixed categories,
 * a small set of validated tags, exception class names, and stack locations
 * (relative file, line, function name) without arguments, variables or
 * source lines.
 *
 * `sanitize()` runs as the SDK's `before_send` callback and rebuilds every
 * outgoing event from these allowlisted parts, so anything another part of
 * the SDK attached on the way is dropped as well.
 */
class SafeEvent {

	/**
	 * Mollie OAuth flows that report errors.
	 */
	const FLOWS = array( 'authorize', 'callback', 'select_profile', 'refresh' );

	/**
	 * What went wrong.
	 */
	const CATEGORIES = array(
		'exception',           // Uncaught exception or error in the flow.
		'php_error',           // PHP warning or notice during the flow.
		'fatal_error',         // PHP fatal error during the flow.
		'authorization_error', // Mollie returned an error other than a cancellation.
		'transport_failed',    // A request to Mollie failed before an answer.
		'http_error',          // Mollie answered with an unexpected HTTP status.
		'invalid_response',    // Mollie answered 200 without the expected data.
	);

	/**
	 * Which call to Mollie failed.
	 */
	const STEPS = array( 'token_exchange', 'organization', 'profiles', 'token_refresh' );

	/**
	 * OAuth 2.0 error codes (RFC 6749 §4.1.2.1 and §5.2). Any other value a
	 * provider returns is reported as "other".
	 */
	const OAUTH_ERRORS = array(
		'invalid_request',
		'invalid_client',
		'invalid_grant',
		'unauthorized_client',
		'unsupported_grant_type',
		'unsupported_response_type',
		'invalid_scope',
		'access_denied',
		'server_error',
		'temporarily_unavailable',
	);

	/**
	 * PHP error types, by the name reported.
	 */
	const PHP_ERROR_TYPES = array(
		E_ERROR             => 'E_ERROR',
		E_WARNING           => 'E_WARNING',
		E_PARSE             => 'E_PARSE',
		E_NOTICE            => 'E_NOTICE',
		E_CORE_ERROR        => 'E_CORE_ERROR',
		E_CORE_WARNING      => 'E_CORE_WARNING',
		E_COMPILE_ERROR     => 'E_COMPILE_ERROR',
		E_COMPILE_WARNING   => 'E_COMPILE_WARNING',
		E_USER_ERROR        => 'E_USER_ERROR',
		E_USER_WARNING      => 'E_USER_WARNING',
		E_USER_NOTICE       => 'E_USER_NOTICE',
		E_RECOVERABLE_ERROR => 'E_RECOVERABLE_ERROR',
		E_DEPRECATED        => 'E_DEPRECATED',
		E_USER_DEPRECATED   => 'E_USER_DEPRECATED',
	);

	/**
	 * Tag names an event may carry.
	 */
	const TAGS = array( 'flow', 'category', 'step', 'http_status', 'oauth_error', 'php_error_type' );

	/**
	 * Fixed text standing in for an exception message.
	 */
	const EXCEPTION_VALUE = 'Message removed';

	/**
	 * Most stack frames kept per exception.
	 */
	const MAX_FRAMES = 50;

	/**
	 * Most exceptions kept from a chain of previous exceptions.
	 */
	const MAX_EXCEPTIONS = 5;

	/**
	 * Event for an operational failure: an error answer or a failed request.
	 *
	 * @param string $flow     Flow (see FLOWS).
	 * @param string $category Category (see CATEGORIES).
	 * @param array  $details  Optional `step`, `http_status` and `oauth_error`.
	 * @return Event
	 */
	public static function failure( $flow, $category, array $details = array() ) {
		$tags = array(
			'flow'     => $flow,
			'category' => $category,
		);
		foreach ( array( 'step', 'http_status', 'oauth_error' ) as $name ) {
			if ( isset( $details[ $name ] ) ) {
				$tags[ $name ] = $details[ $name ];
			}
		}

		return self::create( $tags, Severity::error(), array() );
	}

	/**
	 * Event for an uncaught exception or error.
	 *
	 * @param string     $flow      Flow (see FLOWS).
	 * @param \Throwable $throwable What was thrown.
	 * @return Event
	 */
	public static function exception( $flow, \Throwable $throwable ) {
		$exceptions = array();
		$current    = $throwable;
		for ( $depth = 0; null !== $current && $depth < self::MAX_EXCEPTIONS; $depth++ ) {
			$exceptions[] = self::exception_data(
				$current,
				get_class( $current ),
				self::frames( $current->getFile(), $current->getLine(), $current->getTrace() )
			);
			$current      = $current->getPrevious();
		}

		// Sentry lists the outermost exception last.
		return self::create(
			array(
				'flow'     => $flow,
				'category' => 'exception',
			),
			Severity::error(),
			array_reverse( $exceptions )
		);
	}

	/**
	 * Event for a PHP warning, notice or error. Its message is never sent.
	 *
	 * @param string $flow     Flow (see FLOWS).
	 * @param string $category `php_error` or `fatal_error`.
	 * @param int    $type     PHP error type (E_* constant).
	 * @param string $file     File the error happened in.
	 * @param int    $line     Line the error happened on.
	 * @param array  $trace    Call stack without arguments, innermost first.
	 * @return Event
	 */
	public static function php_error( $flow, $category, $type, $file, $line, array $trace = array() ) {
		$type_name = self::PHP_ERROR_TYPES[ $type ] ?? 'E_UNKNOWN';

		return self::create(
			array(
				'flow'           => $flow,
				'category'       => $category,
				'php_error_type' => $type_name,
			),
			'fatal_error' === $category ? Severity::fatal() : Severity::warning(),
			array( self::exception_data( new \ErrorException(), $type_name, self::frames( $file, $line, $trace ), 'php_error' === $category ) )
		);
	}

	/**
	 * Rebuild an outgoing event from its allowlisted parts only.
	 *
	 * Used as the SDK's `before_send` callback. Request data, user, extra,
	 * contexts, breadcrumbs, modules, server name, frame variables and source
	 * lines, absolute paths, and unknown tag values never survive it.
	 *
	 * @param Event $event Event about to be sent.
	 * @return Event
	 */
	public static function sanitize( Event $event ) {
		$exceptions = array();
		foreach ( array_slice( $event->getExceptions(), -self::MAX_EXCEPTIONS ) as $exception ) {
			$frames     = array();
			$stacktrace = $exception->getStacktrace();
			if ( null !== $stacktrace ) {
				foreach ( array_slice( $stacktrace->getFrames(), -self::MAX_FRAMES ) as $frame ) {
					$frames[] = self::frame( $frame->getFunctionName(), $frame->getFile(), $frame->getLine() );
				}
			}
			$mechanism    = $exception->getMechanism();
			$exceptions[] = self::exception_data( new \Exception(), $exception->getType(), $frames, null !== $mechanism && $mechanism->isHandled() );
		}

		$safe = self::create( $event->getTags(), $event->getLevel(), $exceptions, $event );
		$safe->setRelease( self::label( $event->getRelease() ) );
		$safe->setEnvironment( self::label( $event->getEnvironment() ) );
		$safe->setSdkIdentifier( $event->getSdkIdentifier() );
		$safe->setSdkVersion( $event->getSdkVersion() );

		return $safe;
	}

	/**
	 * Whether a Mollie authorization error should be reported. A cancelled
	 * authorization is the user's choice, not a failure.
	 *
	 * @param string $error OAuth error code from the callback.
	 * @return bool
	 */
	public static function is_reportable_authorization_error( $error ) {
		return 'access_denied' !== $error;
	}

	/**
	 * A file path relative to the plugins directory, or WordPress, or just
	 * its name, so no server layout is sent.
	 *
	 * @param string $file File path.
	 * @return string
	 */
	public static function relative_path( $file ) {
		$file  = str_replace( '\\', '/', (string) $file );
		$roots = array( str_replace( '\\', '/', dirname( __DIR__, 3 ) ) . '/' );
		if ( defined( 'ABSPATH' ) ) {
			$roots[] = str_replace( '\\', '/', ABSPATH );
		}

		$relative = null;
		foreach ( $roots as $root ) {
			if ( '/' !== $root && 0 === strpos( $file, $root ) ) {
				$relative = substr( $file, strlen( $root ) );
				break;
			}
		}

		// Outside the known roots, an absolute path keeps only its file name.
		if ( null === $relative ) {
			$relative = preg_match( '#^(/|[A-Za-z]:)#', $file ) ? basename( $file ) : $file;
		}

		if ( false !== strpos( $relative, '..' ) || ! preg_match( '#^[A-Za-z0-9_][A-Za-z0-9_./-]*$#', $relative ) ) {
			return '[unknown]';
		}

		return $relative;
	}

	/**
	 * Create an event from tags, after validating each one.
	 *
	 * @param array                   $tags       Proposed tags.
	 * @param Severity|null           $level      Severity.
	 * @param array<ExceptionDataBag> $exceptions Allowlisted exceptions.
	 * @param Event|null              $original   Event whose ID and time to keep.
	 * @return Event
	 */
	private static function create( array $tags, $level, array $exceptions, $original = null ) {
		$tags  = self::tags( $tags );
		$event = Event::createEvent( null === $original ? null : $original->getId() );
		if ( null !== $original ) {
			$event->setTimestamp( $original->getTimestamp() );
		}

		$event->setLevel( $level instanceof Severity ? $level : Severity::error() );
		$event->setTags( $tags );
		$event->setLogger( 'fair-platform' );

		$message = sprintf( 'Mollie OAuth %s: %s', $tags['flow'], $tags['category'] );
		if ( isset( $tags['step'] ) ) {
			$message .= ' (' . $tags['step'] . ')';
		}
		$event->setMessage( $message );
		$event->setExceptions( $exceptions );

		return $event;
	}

	/**
	 * Keep only known tags with valid values.
	 *
	 * @param array $tags Proposed tags.
	 * @return array<string, string>
	 */
	private static function tags( array $tags ) {
		$safe = array(
			'flow'     => self::allowed( $tags['flow'] ?? null, self::FLOWS, 'unknown' ),
			'category' => self::allowed( $tags['category'] ?? null, self::CATEGORIES, 'other' ),
		);

		if ( isset( $tags['step'] ) ) {
			$safe['step'] = self::allowed( $tags['step'], self::STEPS, 'other' );
		}

		if ( isset( $tags['http_status'] ) ) {
			$status = is_numeric( $tags['http_status'] ) ? (int) $tags['http_status'] : 0;
			if ( $status >= 100 && $status <= 599 ) {
				$safe['http_status'] = (string) $status;
			}
		}

		if ( isset( $tags['oauth_error'] ) && '' !== $tags['oauth_error'] ) {
			$safe['oauth_error'] = self::allowed( $tags['oauth_error'], self::OAUTH_ERRORS, 'other' );
		}

		if ( isset( $tags['php_error_type'] ) ) {
			$safe['php_error_type'] = self::allowed( $tags['php_error_type'], array_values( self::PHP_ERROR_TYPES ), 'E_UNKNOWN' );
		}

		return $safe;
	}

	/**
	 * A value from a fixed list, or the fallback.
	 *
	 * @param mixed  $value    Proposed value.
	 * @param array  $allowed  Allowed values.
	 * @param string $fallback Value used otherwise.
	 * @return string
	 */
	private static function allowed( $value, array $allowed, $fallback ) {
		return is_string( $value ) && in_array( $value, $allowed, true ) ? $value : $fallback;
	}

	/**
	 * A release (`fair-platform@1.5.2`) or environment label, if it looks like one.
	 *
	 * @param string|null $value Label.
	 * @return string|null
	 */
	private static function label( $value ) {
		return is_string( $value ) && preg_match( '/^[A-Za-z0-9._+@-]{1,64}$/', $value ) ? $value : null;
	}

	/**
	 * Exception entry with a fixed message and the given frames.
	 *
	 * @param \Throwable   $carrier Throwable the SDK object is created from; its message is replaced.
	 * @param string       $type    Class name or PHP error type.
	 * @param array<Frame> $frames  Frames, outermost first.
	 * @param bool         $handled Whether the flow continued (a warning) rather than crashed.
	 * @return ExceptionDataBag
	 */
	private static function exception_data( \Throwable $carrier, $type, array $frames, $handled = false ) {
		$data = new ExceptionDataBag( $carrier, empty( $frames ) ? null : new Stacktrace( $frames ), new ExceptionMechanism( ExceptionMechanism::TYPE_GENERIC, (bool) $handled ) );
		$data->setType( self::identifier( $type, 'Throwable' ) );
		$data->setValue( self::EXCEPTION_VALUE );

		return $data;
	}

	/**
	 * Frames for a location and the call stack above it, outermost first.
	 *
	 * Each PHP trace entry names a called function and where it was called
	 * from, so a frame's function is the next entry's.
	 *
	 * @param string $file  File of the innermost location.
	 * @param int    $line  Line of the innermost location.
	 * @param array  $trace PHP trace, innermost first; arguments are ignored.
	 * @return array<Frame>
	 */
	private static function frames( $file, $line, array $trace ) {
		$frames = array();
		$trace  = array_values( $trace );

		$location = array(
			'file' => $file,
			'line' => $line,
		);
		foreach ( array_merge( $trace, array( null ) ) as $entry ) {
			if ( count( $frames ) >= self::MAX_FRAMES ) {
				break;
			}

			if ( isset( $location['file'] ) ) {
				$frames[] = self::frame(
					null === $entry ? null : self::function_name( $entry ),
					$location['file'],
					$location['line'] ?? 0
				);
			}

			$location = is_array( $entry ) ? $entry : array();
		}

		return array_reverse( $frames );
	}

	/**
	 * A frame carrying only a function name, relative file and line.
	 *
	 * @param string|null $function_name Function name.
	 * @param string      $file          File path.
	 * @param int         $line          Line.
	 * @return Frame
	 */
	private static function frame( $function_name, $file, $line ) {
		$function_name = null === $function_name ? null : self::identifier( $function_name, null );
		$path          = self::relative_path( $file );

		return new Frame( $function_name, $path, max( 0, (int) $line ), null, null, array(), 0 === strpos( $path, 'fair-platform/' ) );
	}

	/**
	 * `Class::method`, `Class->method` or `function` from a trace entry.
	 *
	 * @param array $entry PHP trace entry.
	 * @return string|null
	 */
	private static function function_name( array $entry ) {
		if ( ! isset( $entry['function'] ) || ! is_string( $entry['function'] ) ) {
			return null;
		}

		if ( isset( $entry['class'], $entry['type'] ) && is_string( $entry['class'] ) ) {
			return $entry['class'] . ( '->' === $entry['type'] ? '->' : '::' ) . $entry['function'];
		}

		return $entry['function'];
	}

	/**
	 * A PHP code identifier (class, function, method, closure), or the fallback.
	 *
	 * @param mixed       $value    Proposed identifier.
	 * @param string|null $fallback Value used otherwise.
	 * @return string|null
	 */
	private static function identifier( $value, $fallback ) {
		if ( ! is_string( $value ) || strlen( $value ) > 255 ) {
			return $fallback;
		}

		// PHP 8.4+ names closures after where they are defined, which can be
		// an absolute path; keep only the generic name.
		$value = preg_replace( '/\{closure[^}]*\}/', '{closure}', $value );

		return preg_match( '/^[A-Za-z_\\\\{][A-Za-z0-9_\\\\{}:>-]*$/', $value ) ? $value : $fallback;
	}
}
