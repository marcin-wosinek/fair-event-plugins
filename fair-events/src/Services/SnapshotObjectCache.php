<?php
/**
 * In-memory object cache used while a database snapshot is read.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * A private, request-local stand-in for the global object cache.
 *
 * CampaignSnapshot installs it as `$wp_object_cache` for the duration of a
 * snapshot read, so every WordPress API read (posts, post meta, options)
 * misses the site's cache and goes to the database inside the snapshot, and
 * nothing read there is written to the site's cache, including a
 * persistent Redis or Memcached cache. The instance is discarded when the
 * snapshot ends and the original cache is put back.
 *
 * It implements the methods the core `wp_cache_*()` functions and common
 * persistent-cache drop-ins call. Anything else answers false.
 */
class SnapshotObjectCache {

	/**
	 * Cached values by group and key.
	 *
	 * @var array<string, array<string, mixed>>
	 */
	private $cache = array();

	/**
	 * Current blog ID, so switched blogs never share keys.
	 *
	 * @var int
	 */
	private $blog_id = 0;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->blog_id = function_exists( 'get_current_blog_id' ) ? (int) get_current_blog_id() : 0;
	}

	/**
	 * Whether a value is stored under a key, for the snapshot's own check.
	 *
	 * @param int|string $key   Key.
	 * @param string     $group Group.
	 * @return bool
	 */
	public function holds( $key, $group = 'default' ) {
		return array_key_exists( $this->key( $key ), $this->cache[ $this->group( $group ) ] ?? array() );
	}

	/**
	 * Add a value unless the key is set.
	 *
	 * @param int|string $key    Key.
	 * @param mixed      $data   Value.
	 * @param string     $group  Group.
	 * @param int        $expire Ignored.
	 * @return bool
	 */
	public function add( $key, $data, $group = 'default', $expire = 0 ) {
		if ( function_exists( 'wp_suspend_cache_addition' ) && wp_suspend_cache_addition() ) {
			return false;
		}

		if ( $this->holds( $key, $group ) ) {
			return false;
		}

		return $this->set( $key, $data, $group, $expire );
	}

	/**
	 * Add several values.
	 *
	 * @param array  $data   Values by key.
	 * @param string $group  Group.
	 * @param int    $expire Ignored.
	 * @return bool[]
	 */
	public function add_multiple( array $data, $group = '', $expire = 0 ) {
		$results = array();
		foreach ( $data as $key => $value ) {
			$results[ $key ] = $this->add( $key, $value, $group, $expire );
		}
		return $results;
	}

	/**
	 * Replace a value only when the key is set.
	 *
	 * @param int|string $key    Key.
	 * @param mixed      $data   Value.
	 * @param string     $group  Group.
	 * @param int        $expire Ignored.
	 * @return bool
	 */
	public function replace( $key, $data, $group = 'default', $expire = 0 ) {
		if ( ! $this->holds( $key, $group ) ) {
			return false;
		}

		return $this->set( $key, $data, $group, $expire );
	}

	/**
	 * Store a value.
	 *
	 * @param int|string $key    Key.
	 * @param mixed      $data   Value.
	 * @param string     $group  Group.
	 * @param int        $expire Ignored.
	 * @return bool
	 */
	public function set( $key, $data, $group = 'default', $expire = 0 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- core signature.
		$this->cache[ $this->group( $group ) ][ $this->key( $key ) ] = is_object( $data ) ? clone $data : $data;
		return true;
	}

	/**
	 * Store several values.
	 *
	 * @param array  $data   Values by key.
	 * @param string $group  Group.
	 * @param int    $expire Ignored.
	 * @return bool[]
	 */
	public function set_multiple( array $data, $group = '', $expire = 0 ) {
		$results = array();
		foreach ( $data as $key => $value ) {
			$results[ $key ] = $this->set( $key, $value, $group, $expire );
		}
		return $results;
	}

	/**
	 * Read a value.
	 *
	 * @param int|string $key   Key.
	 * @param string     $group Group.
	 * @param bool       $force Ignored.
	 * @param bool|null  $found Whether the key was found.
	 * @return mixed|false
	 */
	public function get( $key, $group = 'default', $force = false, &$found = null ) {
		if ( ! $this->holds( $key, $group ) ) {
			$found = false;
			return false;
		}

		$found = true;
		$value = $this->cache[ $this->group( $group ) ][ $this->key( $key ) ];
		return is_object( $value ) ? clone $value : $value;
	}

	/**
	 * Read several values.
	 *
	 * @param array  $keys  Keys.
	 * @param string $group Group.
	 * @param bool   $force Ignored.
	 * @return array Values by key, false for missing ones.
	 */
	public function get_multiple( $keys, $group = 'default', $force = false ) {
		$values = array();
		foreach ( (array) $keys as $key ) {
			$values[ $key ] = $this->get( $key, $group, $force );
		}
		return $values;
	}

	/**
	 * Remove a value.
	 *
	 * @param int|string $key        Key.
	 * @param string     $group      Group.
	 * @param bool       $deprecated Ignored.
	 * @return bool
	 */
	public function delete( $key, $group = 'default', $deprecated = false ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- core signature.
		if ( ! $this->holds( $key, $group ) ) {
			return false;
		}

		unset( $this->cache[ $this->group( $group ) ][ $this->key( $key ) ] );
		return true;
	}

	/**
	 * Remove several values.
	 *
	 * @param array  $keys  Keys.
	 * @param string $group Group.
	 * @return bool[]
	 */
	public function delete_multiple( array $keys, $group = '' ) {
		$results = array();
		foreach ( $keys as $key ) {
			$results[ $key ] = $this->delete( $key, $group );
		}
		return $results;
	}

	/**
	 * Increment a numeric value.
	 *
	 * @param int|string $key    Key.
	 * @param int        $offset Amount.
	 * @param string     $group  Group.
	 * @return int|false
	 */
	public function incr( $key, $offset = 1, $group = 'default' ) {
		if ( ! $this->holds( $key, $group ) ) {
			return false;
		}

		$value = max( 0, (int) $this->get( $key, $group ) + (int) $offset );
		$this->set( $key, $value, $group );
		return $value;
	}

	/**
	 * Decrement a numeric value.
	 *
	 * @param int|string $key    Key.
	 * @param int        $offset Amount.
	 * @param string     $group  Group.
	 * @return int|false
	 */
	public function decr( $key, $offset = 1, $group = 'default' ) {
		return $this->incr( $key, -1 * (int) $offset, $group );
	}

	/**
	 * Remove everything.
	 *
	 * @return bool
	 */
	public function flush() {
		$this->cache = array();
		return true;
	}

	/**
	 * Remove everything (there is only a runtime cache).
	 *
	 * @return bool
	 */
	public function flush_runtime() {
		return $this->flush();
	}

	/**
	 * Remove one group.
	 *
	 * @param string $group Group.
	 * @return bool
	 */
	public function flush_group( $group ) {
		unset( $this->cache[ $this->group( $group ) ] );
		return true;
	}

	/**
	 * Optional features this cache supports.
	 *
	 * @param string $feature Feature name.
	 * @return bool
	 */
	public function supports( $feature ) {
		return in_array( $feature, array( 'add_multiple', 'set_multiple', 'get_multiple', 'delete_multiple', 'flush_runtime', 'flush_group' ), true );
	}

	/**
	 * Switch the blog keys are scoped to.
	 *
	 * @param int $blog_id Blog ID.
	 * @return void
	 */
	public function switch_to_blog( $blog_id ) {
		$this->blog_id = (int) $blog_id;
	}

	/**
	 * Group registration is irrelevant to a private cache.
	 *
	 * @param string|string[] $groups Groups.
	 * @return void
	 */
	public function add_global_groups( $groups ) {
	}

	/**
	 * Group registration is irrelevant to a private cache.
	 *
	 * @param string|string[] $groups Groups.
	 * @return void
	 */
	public function add_non_persistent_groups( $groups ) {
	}

	/**
	 * Nothing to close.
	 *
	 * @return bool
	 */
	public function close() {
		return true;
	}

	/**
	 * Methods of other cache implementations answer false.
	 *
	 * @param string $name      Method name.
	 * @param array  $arguments Arguments.
	 * @return false
	 */
	public function __call( $name, $arguments ) {
		return false;
	}

	/**
	 * Group name, defaulting like core.
	 *
	 * @param string $group Group.
	 * @return string
	 */
	private function group( $group ) {
		return ( '' === (string) $group ? 'default' : (string) $group );
	}

	/**
	 * Key scoped to the current blog.
	 *
	 * @param int|string $key Key.
	 * @return string
	 */
	private function key( $key ) {
		return $this->blog_id . ':' . $key;
	}
}
