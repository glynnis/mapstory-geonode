'use strict';

(function(){

  var module = angular.module('geonode_main_search', [], function($locationProvider) {
      if (window.navigator.userAgent.indexOf("MSIE") == -1){
        $locationProvider.html5Mode({
          enabled: true,
          requireBase: false
        });
        // make sure that angular doesn't intercept the page links
        angular.element("a").prop("target", "_self");
      }
    });

  module.directive('ngEnter', function () {
    return function (scope, element, attrs) {
      element.bind("keydown keypress", function (event) {
        if(event.which === 13) {
          scope.$apply(function (){
            scope.$eval(attrs.ngEnter);
          });
          event.preventDefault();
        }
      });
    };
  });

    // watch for change in location
    // for property in location.search, 
      // set active property
      // set active class..... (can I simply have the class watch the property?) ng-class="-item-.active"

  // set active class of a filter based on the url parameters
  module.set_active_filters = function (data, url_query, filter_param){
    for(var i=0;i<data.length;i++){
      if( url_query == data[i][filter_param] || url_query.indexOf(data[i][filter_param] ) != -1){
          data[i].active = 'active';
      }else{
          data[i].active = '';
      }
    }
    return data;
  }
  // grab & prep categories, keywords, and regions from endpoints with 'active' queries noted
  // each only called if element with corresponding id is on html page
  module.load_active_list = function ($http, $rootScope, $location, api, endpoint, filter, value){
      var params = typeof FILTER_TYPE == 'undefined' ? {} : {'type': FILTER_TYPE};
      $http.get(endpoint, {params: params}).success(function(data){
        //sets an active property if category already selected in a url query
        if($location.search().hasOwnProperty(filter)){
            data.objects = module.set_active_filters(data.objects,
                $location.search()[filter], value);
          }
        //front-end filtering  of categories to avoid reprovision, 
        if (api === 'categories'){
          //geonode's initial_data.json pulls in categories we don't want
          data.objects = _.where(data.objects,{'description': ''});
        }
        $rootScope[api]= data.objects;
      });
    }

  /*
  * Load categories and keywords if the filter is available in the page
  * set active class if needed, update here for facet counts if enabled in settings
  */
  module.run(function($http, $rootScope, $location){
    if ($('#categories').length > 0){
      module.load_active_list($http, $rootScope, $location, 'categories',
        CATEGORIES_ENDPOINT,'category__identifier__in', 'identifier');
    }
    if ($('#keywords').length > 0){
      module.load_active_list($http, $rootScope, $location, 'keywords',
        KEYWORDS_ENDPOINT,'keywords__slug__in', 'slug');
    }
    if ($('#regions').length > 0){
      module.load_active_list($http, $rootScope, $location, 'regions',
        REGIONS_ENDPOINT,'regions__name__in', 'name');
    }
    //note: we don't load #owners like in geonode/search.js, grab it if ya need it
    //insert module.haystack_facets() from geonode/search.js & un-comment this if we turn on HAYSTACK_FACET_COUNTS
    /* 
    if (HAYSTACK_FACET_COUNTS && $rootScope.query_data) {
         module.haystack_facets($http, $rootScope, $location);
    } 
    */
  });

  /*
  * Main search controller
  * Load data from api and defines the multiple and single choice handlers
  * Syncs the browser url with the selections
  */
  module.controller('geonode_search_controller', function($injector, $scope, $location, $http, $q, Configs, Django){
    $scope.api_endpoint = '/api/base/search/';
    $scope.query = $location.search();
    $scope.query.limit = $scope.query.limit || CLIENT_RESULTS_LIMIT;
    $scope.query.offset = $scope.query.offset || 0;
    //remove is_published: true for a user's drafts to appear in their search
    $scope.query.is_published = 'true';
    $scope.trending = [];
    $scope.page = Math.round(($scope.query.offset / $scope.query.limit) + 1);
    $scope.numpages = Math.round(($scope.total_counts / $scope.query.limit) + 0.49);
    $scope.django = Django.all();

    $scope.search = function() {
      return query_api($scope.query).then(function(result) {
        return result;
      });
    };

    if (!Configs.hasOwnProperty("disableQuerySync")) {
      // Keep in sync the page location with the query object
      $scope.$watch('query', function(){
        $location.search($scope.query);
      }, true);
    } 

    $scope.showUserGroup = function() {
        if ($location.search().hasOwnProperty('type__in')) {
            var typeInParam = $location.search()['type__in'];
            if (typeof(typeInParam) === "string") {
                if (typeInParam === 'user' || typeInParam === 'group') {
                    return true;
                }
            } else if (typeof(typeInParam) === "object") {
                for(var i = 0; i < typeInParam.length; i++) {
                  if(typeInParam[i] === 'user' || typeInParam[i] === 'group') {
                      return true;
                    }
                };
            }
          }
        return false;
    };

    //Get data from apis and make them available to the page
    function query_api(data){

      return $http.get($scope.api_endpoint, {params: data || {}}).success(function(data){
        $scope.results = data.objects;
        $scope.total_counts = data.meta.total_count;
        $scope.$root.query_data = data;
        if (HAYSTACK_SEARCH) {
          if ($location.search().hasOwnProperty('q')){
            $scope.text_query = $location.search()['q'].replace(/\W+/g," ");
          }
          if ($location.search().hasOwnProperty('type__in')){
            // TODO Apr 27 2016: Take into account multiple values for 'type__in'
            //$scope.type__in = $location.search()['type__in'].replace(/\W+/g," ");
          }
        } else {
          if ($location.search().hasOwnProperty('title__icontains')){
            $scope.text_query = $location.search()['title__icontains'].replace(/\W+/g," ");
          }
        }
        //pull in $("#types") for subtype&type from geonode/search.js if HAYSTACK_FACET_COUNTS enabled
        //to Update facet/keyword/category counts from search results
      });
    };

    // Grab the keywords and sort them by 'count' to determine the trending tags
    function trending_keywords_query(data) {
      return $http.get('/api/keywords', {params: data || {}}).success(function(data){
        if($location.search().hasOwnProperty('keywords__slug__in')){
            data.objects = module.set_active_filters(data.objects,
                $location.search()['keywords__slug__in'], 'slug');
        }

        var results = data.objects;
        // Sort them by count in order from highest to lowest
        results.sort(function(kw1, kw2) {
          return kw2.count - kw1.count;
        });
        // Grab the top 8 // or change the # displaying here
        var num_trending = (results.length > 8) ? 8 : results.length;
        for (var i = 0; i < num_trending; i++) {
          if (results[i].count > 0) $scope.trending.push(results[i]);
        }
      });
    };
    trending_keywords_query();

    //used in detail page 'related' tab and featured content on index page
    $scope.query_category = function(category, type) {
      $scope.query.type__in = type; //only needed for detail page
      $scope.query.category__identifier__in = category;
      $scope.search();
    };
    //used in what's-hot for switching to featured and profile
    $scope.change_api = function(api_endpoint) {
      Configs.url = "/api/" + api_endpoint + "/";
      $scope.query.limit = CLIENT_RESULTS_LIMIT;
      $scope.query.offset = 0;
      return query_api($scope.query).then(function(result) {
        return result;
      });
    };

    $scope.get_url = function() {
      return Configs.url;
    };

    /*
    * Pagination 
    */
    // Control what happens when the total results change
    $scope.$watch('total_counts', function(){
      $scope.numpages = Math.round(
        ($scope.total_counts / $scope.query.limit) + 0.49
      );

      // In case the user is viewing a page > 1 and a 
      // subsequent query returns less pages, then 
      // reset the page to one and search again.
      if($scope.numpages < $scope.page){
        $scope.page = 1;
        $scope.query.offset = 0;
        query_api($scope.query);
      }

      // In case of no results, the number of pages is one.
      if($scope.numpages == 0){$scope.numpages = 1};
    });

    $scope.paginate_down = function(){
      if($scope.page > 1){
        $scope.page -= 1;
        $scope.query.offset =  $scope.query.limit * ($scope.page - 1);
        query_api($scope.query);
      }   
    }

    $scope.paginate_up = function(){
      if($scope.numpages > $scope.page){
        $scope.page += 1;
        $scope.query.offset = $scope.query.limit * ($scope.page - 1);
        query_api($scope.query);
      }
    }
    /*
    * End pagination
    */

    /*$scope.multiple_choice_listener from geonode/search.js used to:
    * Add the selection behavior to the element, it adds/removes the 'active' class
    * and pushes/removes the value of the element from the query object
    */

    /*
    * Setting the query to a single element - replaces single_choice_listener
    */
    $scope.set_query = function(filter, value) {
      $scope.query = {};
      $scope.query[filter] = value;
      query_api($scope.query);
    }

    /*
    * Add the query, replacing any current query
    * Good for mutually exclusive types
    */
    $scope.add_single_query = function(filter, value) {
      $scope.query[filter] = value;
      query_api($scope.query);
    }

    /*
    * Add the query, appending it to any current query
    */
    $scope.add_query = function(filter, value) {
      var query_entry = [];
      if ($scope.query.hasOwnProperty(filter)) {
        //if theres a list of items, grab them. otherwise, add the only value to empty list
        if ($scope.query[filter] instanceof Array) {
          query_entry = $scope.query[filter];
        } else {
          query_entry.push($scope.query[filter]);
        }
        // Only add it if this value doesn't already exist
        // Apparently this doesn't exactly work...
        if ($scope.query[filter].indexOf(value) == -1) {
          query_entry.push(value);
        }
      } else {
        query_entry = [value];
      }
      $scope.query[filter] = query_entry;
      query_api($scope.query);
    }

    /*
    * Toggle adding/removing this filter
    */
    $scope.toggle_query = function(toggle, filter, value) {
      if (toggle) {
        $scope.add_query(filter, value);
      } else {
        $scope.remove_query(filter, value);
      }
    }

    /*
    * Remove the query
    */
    $scope.remove_query = function(filter, value) {
      var query_entry = [];
      // First check if this even exists to remove
      if ($scope.query.hasOwnProperty(filter)) {
        // Grab the current query
        if ($scope.query[filter] instanceof Array) {
          query_entry = $scope.query[filter];
        } else {
          query_entry.push($scope.query[filter]);
        }
        // Remove this value
        query_entry.splice(query_entry.indexOf(value), 1);
        // Update and run the query
        $scope.query[filter] = query_entry;
        query_api($scope.query);
      }
    }

    /*
    * Delete all parts of this filter
    */
    $scope.delete_query = function(filter) {
      // First check if this even exists to remove
      if ($scope.query.hasOwnProperty(filter)) {
        $scope.query[filter] = [];
        query_api($scope.query);
      }
    }

    $scope.add_search = function(filter, value, array) {
      if (array.indexOf(value) == -1) {
        array.push(value);
        $scope.add_query(filter, value);
      }
    }

    $scope.remove_search = function(filter, value, array) {
      var index = array.indexOf(value);
      if (index != -1) {
        array.splice(index, 1);
        $scope.remove_query(filter, value);
      }
    }

    $scope.remove_all_queries = function(){
      console.log($scope.query);
      query_api($scope.query);
    }
    // If the below functions & promises are needed, find them in geonode/search.js,
    // don't think we need to implement most popular tallies this way
    // if we have elastic search facets, etc. Note: this wasn't even used.

    // $scope.calculate_popular_items = function() {
    //   calculate_most_popular_interest();
    //   calculate_most_popular_location();
    // }

    // Toggle the background of the header buttons to indicate which one is active
    // Make the content one active, user inactive
    $scope.toggle_content = function() {
      $('#content-search').css('background-color', 'white');
      $('#user-search').css('background-color', 'gainsboro');
      // clear the content search
      $('#tokenfield-profile').tokenfield('setTokens', []);
      $('#tokenfield-region').tokenfield('setTokens', []);
      $('#tokenfield-keyword').tokenfield('setTokens', []);
      $scope.api_endpoint = '/api/owners/';
      // //stash filters for toggle-back
      // $scope.content_stash = $scope.query;
      $scope.query = {limit: CLIENT_RESULTS_LIMIT, offset: 0, q: $scope.query.q};
    };
    // Make the user one active, content inactive
    $scope.toggle_user = function() {
      $('#content-search').css('background-color', 'gainsboro');
      $('#user-search').css('background-color', 'white');
      // clear the user search
      $('#tokenfield-interest').tokenfield('setTokens', []);
      $scope.api_endpoint = '/api/base/search/';
      // //stash filters for toggle-back
      //$scope.content_stash.q = $scope.query.q
      $scope.query = {is_published: true,limit: CLIENT_RESULTS_LIMIT, offset: 0, q: $scope.query.q};// set to $scope.content_stash;
      //remove is_published: true for a user's drafts to appear in their search
    };

// Configure new autocomplete
var profile_autocompletes = [];
var region_autocompletes = [];
var keyword_autocompletes = [];
var city_autocompletes = [];
var usernames = [];
var regions = [];
var keywords = [];
var cities = [];
var countries = [];
// This will contain the country code, i.e. Canada's code is CAN, at the same index location
// as region_autocompletes stores the country name.
var country_codes = [];

function init_tokenfields() {
  var deferred = $q.defer();
  var promises = [];
  promises.push(
    profile_autocomplete()
    .then(function() {
      $('#tokenfield-profile')
        .tokenfield({
          autocomplete: {
            source: profile_autocompletes,
            delay: 100,
            minLength: 3
          },
          showAutocompleteOnFocus: true,
          limit: 10
        })
        .on('tokenfield:createtoken', function(e) {
          // Tokenize by space if num_spaces > 3
          var num_spaces = (e.attrs.value.match(/ /g)||[]).length;
          var data = e.attrs.value.split(' ');
          if (num_spaces > 3) {
            e.attrs.value = data[0];
            e.attrs.label = data[0];
            for (var i = 1; i < data.length; i++) {
              $('#tokenfield-profile').tokenfield('createToken', data[i]);
            }
          }
        })
        .on('tokenfield:createdtoken', function(e) {
          // Match search to possible usernames - casting a wide net for now
          possible_profiles(e.attrs.value).then(function(usernames_to_search) {
            // Duplicates are fine in usernames_to_search because the add_search() function will catch them
            for (var i = 0; i < usernames_to_search.length; i++) {
              $scope.add_search('owner__username__in', usernames_to_search[i], usernames);
            }
          });
        })
        .on('tokenfield:removedtoken', function(e) {
          $scope.remove_search('owner__username__in', e.attrs.value, usernames);
        });

      $('#tokenfield-city')
        .tokenfield({
          autocomplete: {
            source: city_autocompletes,
            delay: 100,
            minLength: 3
          },
          showAutocompleteOnFocus: true,
          limit: 10
        })
        .on('tokenfield:createtoken', function(e) {
          // Tokenize by space if num_spaces > 3
          var num_spaces = (e.attrs.value.match(/ /g)||[]).length;
          var data = e.attrs.value.split(' ');
          if (num_spaces > 3) {
            e.attrs.value = data[0];
            e.attrs.label = data[0];
            for (var i = 1; i < data.length; i++) {
              $('#tokenfield-city').tokenfield('createToken', data[i]);
            }
          }
        })
        .on('tokenfield:createdtoken', function(e) {
          $scope.add_search('city', e.attrs.value, cities);
        })
        .on('tokenfield:removedtoken', function(e) {
          $scope.remove_search('city', e.attrs.value, cities);
        });
    })
  );
  
  promises.push(
    region_autocomplete()
    .then(function() {
      $('#tokenfield-region')
        .tokenfield({
          autocomplete: {
            source: region_autocompletes,
            delay: 100,
            minLength: 3
          },
          showAutocompleteOnFocus: true,
          limit: 10
        })
        .on('tokenfield:createtoken', function(e) {
          // Tokenize by space if num_spaces > 3
          var num_spaces = (e.attrs.value.match(/ /g)||[]).length;
          var data = e.attrs.value.split(' ');
          if (num_spaces > 3) {
            e.attrs.value = data[0];
            e.attrs.label = data[0];
            for (var i = 1; i < data.length; i++) {
              $('#tokenfield-region').tokenfield('createToken', data[i]);
            }
          }
        })
        .on('tokenfield:createdtoken', function(e) {
          $scope.add_search('regions__name__in', e.attrs.value, regions);
        })
        .on('tokenfield:removedtoken', function(e) {
          $scope.remove_search('regions__name__in', e.attrs.value, regions);
        });

      $('#tokenfield-country')
        .tokenfield({
          autocomplete: {
            source: region_autocompletes,
            delay: 100,
            minLength: 3
          },
          showAutocompleteOnFocus: true,
          limit: 10
        })
        .on('tokenfield:createtoken', function(e) {
          // Tokenize by space if num_spaces > 3
          var num_spaces = (e.attrs.value.match(/ /g)||[]).length;
          var data = e.attrs.value.split(' ');
          if (num_spaces > 3) {
            e.attrs.value = data[0];
            e.attrs.label = data[0];
            for (var i = 1; i < data.length; i++) {
              $('#tokenfield-country').tokenfield('createToken', data[i]);
            }
          }
        })
        .on('tokenfield:createdtoken', function(e) {
          if (region_autocompletes.indexOf(e.attrs.value) != -1) {
            $scope.add_search('country', country_codes[region_autocompletes.indexOf(e.attrs.value)], countries);
          }
          
        })
        .on('tokenfield:removedtoken', function(e) {
          if (region_autocompletes.indexOf(e.attrs.value) != -1) {
            $scope.remove_search('country', country_codes[region_autocompletes.indexOf(e.attrs.value)], countries);
          }
        });
    })
  );

  promises.push(
    keyword_autocomplete()
    .then(function() {
      $('#tokenfield-keyword')
        .tokenfield({
          autocomplete: {
            source: keyword_autocompletes,
            delay: 100,
            minLength: 3
          },
          showAutocompleteOnFocus: true,
          limit: 10
        })
        .on('tokenfield:createtoken', function(e) {
          // Tokenize by space if num_spaces > 3
          var num_spaces = (e.attrs.value.match(/ /g)||[]).length;
          var data = e.attrs.value.split(' ');
          if (num_spaces > 3) {
            e.attrs.value = data[0];
            e.attrs.label = data[0];
            for (var i = 1; i < data.length; i++) {
              $('#tokenfield-keyword').tokenfield('createToken', data[i]);
            }
          }
        })
        .on('tokenfield:createdtoken', function(e) {
          $scope.add_search('keywords__slug__in', e.attrs.value, keywords);
        })
        .on('tokenfield:removedtoken', function(e) {
          $scope.remove_search('keywords__slug__in', e.attrs.value, keywords);
        });

      $('#tokenfield-interest')
        .tokenfield({
          autocomplete: {
            source: keyword_autocompletes,
            delay: 100,
            minLength: 3
          },
          showAutocompleteOnFocus: true,
          limit: 10
        })
        .on('tokenfield:createtoken', function(e) {
          // Tokenize by space if num_spaces > 3
          var num_spaces = (e.attrs.value.match(/ /g)||[]).length;
          var data = e.attrs.value.split(' ');
          if (num_spaces > 3) {
            e.attrs.value = data[0];
            e.attrs.label = data[0];
            for (var i = 1; i < data.length; i++) {
              $('#tokenfield-interest').tokenfield('createToken', data[i]);
            }
          }
        })
        .on('tokenfield:createdtoken', function(e) {
          $scope.add_search('interest_list', e.attrs.value, keywords);
        })
        .on('tokenfield:removedtoken', function(e) {
          $scope.remove_search('interest_list', e.attrs.value, keywords);
        });
    })
  );

  $q.all(promises)
    .then(function() {
      deferred.resolve();
    }, function() {
      deferred.reject('Some tokenization field initializations failed');
    }
  );

  return deferred.promise;
}

function profile_autocomplete() {
  return $http.get('/api/owners/')
    .success(function(data){
      var results = data.objects;
      // Here we have first name, last name, and username
      // append them all together to be used in the profile autocomplete
      for (var i = 0; i < results.length; i++) {
        profile_autocompletes.push(results[i].first_name);
        profile_autocompletes.push(results[i].last_name);
        profile_autocompletes.push(results[i].username);
        if (results[i].city != null) {
          city_autocompletes.push(results[i].city);
        }
      }
    });
};

function possible_profiles(token) {
  var promises = [];
  var profiles = [];
  var query = {};
  var deferred = $q.defer();
  // Count spaces in token
  var num_spaces = (token.match(/ /g)||[]).length;
  // If there's no spaces, we might be directly searching a username
  if (num_spaces == 0) {
    profiles.push(token);
  }
  for (var i = 0; i < num_spaces; i++) {
    // split at ith instance of space in token
    // grab first and last name
    query['first_name'] = token.split(' ').slice(0, (i + 1)).join(' ');
    query['last_name'] = token.split(' ').slice(i + 1).join(' ');
    // query api w/query
    promises[i] = $http.get('/api/profiles/', {params: query})
      .success(function(data) {
        var results = data.objects;
        for (var j = 0; j < results.length; j++) {
          profiles.push(results[j].username);
        }
      });
  }
  query['first_name'] = token;
  query['last_name'] = null;
  
  promises.push($http.get('/api/profiles/', {params: query})
    .success(function(data) {
      var results = data.objects;
      for (var j = 0; j < results.length; j++) {
        profiles.push(results[j].username);
      }
    })
  );

  $q.all(promises)
    .then(function() {
      deferred.resolve(profiles);
    }, function() {
      deferred.reject('Some HTTP requests failed');
    });

  return deferred.promise;
};

function region_autocomplete() {
  return $http.get('/api/regions/')
    .success(function(data){
      var results = data.objects;
      for (var i = 0; i < results.length; i++) {
        region_autocompletes.push(results[i].name);
        country_codes.push(results[i].code);
      }
    });
};

function keyword_autocomplete() {
  return $http.get('/api/keywords/')
    .success(function(data){
      var results = data.objects;
      for (var i = 0; i < results.length; i++) {
        keyword_autocompletes.push(results[i].slug);
      }
    });
};

init_tokenfields()


    $scope.filterVTC = function() {
      // When VTC check box is clicked, also filter by VTC; when unchecked, reset it
      if ($scope.VTCisChecked == true) {
        $scope.itemFilter['Volunteer_Technical_Community'] = true;
      } else {
        $scope.itemFilter = { is_active: true };
      }
    };
    $scope.filterVTC();

    $scope.feature_select = function($event){
      var element = $($event.target);
      var article = $(element.parents('article')[0]);
      if (article.hasClass('resource_selected')){
        element.html('Select');
        article.removeClass('resource_selected');
      }
      else{
        element.html('Deselect');
        article.addClass('resource_selected');
      } 
    };

    /*
    * Date management
    */

    $scope.date_query = {
      'date__gte': '',
      'date__lte': ''
    };
    var init_date = true;
    $scope.$watch('date_query', function(){
      if($scope.date_query.date__gte != '' && $scope.date_query.date__lte != ''){
        $scope.query['date__range'] = $scope.date_query.date__gte + ',' + $scope.date_query.date__lte;
        delete $scope.query['date__gte'];
        delete $scope.query['date__lte'];
      }else if ($scope.date_query.date__gte != ''){
        $scope.query['date__gte'] = $scope.date_query.date__gte;
        delete $scope.query['date__range'];
        delete $scope.query['date__lte'];
      }else if ($scope.date_query.date__lte != ''){
        $scope.query['date__lte'] = $scope.date_query.date__lte;
        delete $scope.query['date__range'];
        delete $scope.query['date__gte'];
      }else{
        delete $scope.query['date__range'];
        delete $scope.query['date__gte'];
        delete $scope.query['date__lte'];
      }
      if (!init_date){
        query_api($scope.query);
      }else{
        init_date = false;
      }
      
    }, true);

    // Set the default orderMethod for when a user first hits the Explore page to be descending dates.
    $scope.orderMethod = '-date';
    // Allow the user to choose an order method using the What's Hot section.
    $scope.orderMethodUpdate = function(orderMethod) {
      $scope.orderMethod = orderMethod;
    };

    /*
    * Result Content Card flip!
    */
    $scope.flip = function(id){
       $('.resource-'+id).toggleClass('flip');
    };

    $scope.search();
  });

  // add filter to decode uri
  module.filter('decodeURIComponent', function() {
    return window.decodeURIComponent;
  });
  
})();