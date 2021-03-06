var _ = require('lodash');
var aws = require('aws-sdk');
var mocha = require('mocha');
var expect = require('chai').expect;
var provision = require('./provision-tests');
var dynochamber = require('./index');
var dynoHelpers = require('./helpers');

var storeDescription = {
  tableName: "Movies",
  operations: {
    addMovie: {
      _type: 'put',
      Item: '{{movie}}'
    },
    getMovieWithPart: {
      _type: 'get',
      Key: {
        title: "{{title}}:{{part}}:{{subtitle}}",
        year: "{{year}}"
      }
    },
    getMovie: {
      _type: 'get',
      Key: '{{key}}'
    },
    deleteMovie: {
      _type: 'delete',
      Key: '{{key}}'
    },
    addMovies: {
      _type: 'batchWrite',
      RequestItems: {
        Movies: dynoHelpers.batchWrite({put: '{{movies}}'})
      }
    },
    getMovies: {
      _type: 'batchGet',
      RequestItems: {
        Movies: {Keys: '{{keys}}'}
      },
      Limit: 3
    },
    addGrossAndSetRating: {
      _type: 'update',
      Key: '{{key}}',
      UpdateExpression: 'set rating = :rating add gross :gross',
      ExpressionAttributeValues: {
        ':rating': '{{rating}}',
        ':gross': '{{gross}}'
      }
    },
    getAllMovies: {
      _type: 'scan',
      Limit: 3
    },
    setHighRatingsForHighGrossing: {
      _type: 'update',
      Key: '{{key}}',
      UpdateExpression: 'set rating = :rating',
      ConditionExpression: 'gross > :grossLevel',
      ExpressionAttributeValues: {
        ':rating': '{{rating}}',
        ':grossLevel': 500000
      }
    },
    queryMoviesByYear: {
      _type: 'query',
      KeyConditionExpression: '#year = :year',
      ExpressionAttributeNames: {
        '#year': 'year'
      },
      ExpressionAttributeValues: {
        ':year': '{{year}}'
      },
      Limit: 3
    },
    getMoviesCountWithPaging: {
      _type: 'scan',
      Select: 'COUNT',
      Limit: 2
    }
  }
};

// ----- helpers ---------------
function handleError(done, callback) {
  return function(err, results) {
    if (err) {
      console.log(err);
      expect(err).to.not.exist;

      return done();
    }

    return callback(results);
  };
}
//------------------------------


describe("integration tests for dynochamber", function() {
  before(function(done) {
    provision(done);
  });

  it("should create a movie", function(done) {
    var store = dynochamber.loadStore(storeDescription);
    var movie = {year: 2013, title: "Superman", gross: 2000000};

    store.addMovie({movie}, handleError(done, function(results) {
      store.getMovie({key: {year: 2013, title: "Superman"}}, handleError(done, function(results) {
        expect(results).to.deep.equal(movie);
        return done();
      }));
    }));
  });

  it("should delete movie", function(done) {
    var store = dynochamber.loadStore(storeDescription);

    store.deleteMovie({key: {year: 2013, title: "Superman"}}, handleError(done, function(results) {
      store.getMovie({key: {year: 2013, title: "Superman"}}, handleError(done, function(results) {
        expect(results).to.not.exist;
        return done();
      }));
    }));
  });

  it("should get movie with composite placholder", function(done) {
    var store = dynochamber.loadStore(storeDescription);
    var movie = {year: 2013, title: "Superman:100:omg", gross: 2000000};

    store.addMovie({movie}, handleError(done, function(results) {
      store.getMovieWithPart({year: 2013, title: "Superman", part: "100", subtitle: "omg"}, handleError(done, function(results) {
        expect(results).to.deep.equal(movie);

        store.deleteMovie({key: {year: 2013, title: "Superman:100:omg"}}, done);
      }));
    }));
  });

  it("should batch write movies and batch get movies", function(done) {
    var store = dynochamber.loadStore(storeDescription);
    var movies = [{year: 2015, title: "TMNT", gross: 100000},
                  {year: 2015, title: "Interstellar", gross: 10000000}];

    store.addMovies({movies}, handleError(done, function(results) {
      store.getMovies({keys: _.map(movies, _.partialRight(_.omit, ['gross']))}, handleError(done, function(results) {

        var tmnt = _.find(results.Movies, m => m.title === 'TMNT');
        expect(tmnt).to.deep.equal(movies[0]);

        var interstellar = _.find(results.Movies, m => m.title === 'Interstellar');
        expect(interstellar).to.deep.equal(movies[1]);

        return done();
      }));
    }));
  });

  it("should update movie", function(done) {
    var store = dynochamber.loadStore(storeDescription);

    store.addGrossAndSetRating({key: {year: 2015, title: 'TMNT'}, rating: 4, gross: 20000}, handleError(done, function(results) {
      store.getMovie({key: {year: 2015, title: 'TMNT'}}, handleError(done, function(results) {
        expect(results).to.deep.equal({
          year: 2015,
          title: 'TMNT',
          rating: 4,
          gross: 120000
        });

        return done();
      }));
    }));
  });

  it("should get all movies by scan", function(done) {
    var store = dynochamber.loadStore(storeDescription);

    store.getAllMovies(null, handleError(done, function(results) {
      var movies = [{year: 2015, title: "TMNT", gross: 120000, rating: 4},
                    {year: 2015, title: "Interstellar", gross: 10000000}];

      var tmnt = _.find(results, m => m.title === 'TMNT');
      expect(tmnt).to.deep.equal(movies[0]);

      var interstellar = _.find(results, m => m.title === 'Interstellar');
      expect(interstellar).to.deep.equal(movies[1]);

      return done();
    }));
  });

  it("should update movie with conditional", function(done) {
    var store = dynochamber.loadStore(storeDescription);

    store.setHighRatingsForHighGrossing({key: {year: 2015, title: 'TMNT'}, rating: 10}, function(err, results) {
      expect(err.code).to.deep.equal("ConditionalCheckFailedException");
      return done();
    });
  });

  it("should query movies based on the year", function(done) {
    var store = dynochamber.loadStore(storeDescription);

    store.addMovies({movies: [{year: 2001, title: 'Matrix'}, {year: 1985, title: 'Robocop'}]}, handleError(done, function(results) {
      store.queryMoviesByYear({year: 2001}, handleError(done, function(results) {
        expect(results.length).to.equal(1);
        expect(results[0]).to.deep.equal({year: 2001, title: 'Matrix'});
        return done();
      }));
    }));
  });

  it("should support tableName as a function", function(done) {
    var storeDefinition = {
      tableName: _ => "Movies",
      operations: {
        getMovie: {
          _type: 'get',
          Key: '{{key}}'
        }
      }
    };

    var store = dynochamber.loadStore(storeDescription);

    store.getMovie({key: {year: 2015, title: "TMNT"}}, handleError(done, function(results) {
      var expectedResult = {
        "rating": 4,
        "gross": 120000,
        "title": "TMNT",
        "year": 2015
      };

      expect(results).deep.equal(expectedResult);
      return done();
    }));
  });

  describe("paging", function() {
    var store = null;

    before(function(done) {
      var movies = [
        {year: 1995, title: 'ToyStory'},
        {year: 1990, title: 'It'},
        {year: 1982, title: 'The Thing'},
        {year: 1978, title: 'Halloween'}

      ];

      store = dynochamber.loadStore(storeDescription);
      store.addMovies({movies}, done);
    });

    it("should be supported by scan", function(done) {
      var currentPage = 0;
      var expectedPages = [
        [{
          "title": "Matrix",
          "year": 2001
        },
         {
           "title": "ToyStory",
           "year": 1995
         },
         {
           "title": "It",
           "year": 1990
         }
        ],
        [{
          "title": "The Thing",
          "year": 1982
        },
         {
           "title": "Interstellar",
           "gross": 10000000,
           "year": 2015
         },
         {
           "rating": 4,
           "gross": 120000,
           "title": "TMNT",
           "year": 2015
         }
        ],
        [{
          "title": "Robocop",
          "year": 1985
        },
         {
           "title": "Halloween",
           "year": 1978
         }
        ]];

      var pageCallback = function(page, callback) {
        expect(page).to.deep.equal(expectedPages[currentPage++]);
        return callback();
      };

      store.getAllMovies({_options: {pages: 'all', pageCallback}}, done);
    });

    it("should be supported by query", function(done) {
      store.addMovies({movies: [
        {year: 1985, title: 'Back to the Future'},
        {year: 1985, title: 'The Goonies'},
        {year: 1985, title: 'The Breakfast Club'},
        {year: 1985, title: 'Rocky IV'},
        {year: 1985, title: 'A Nightmare on Elm Street Part 2: Freddy\'s Revenge'},
        {year: 1985, title: 'Commando'}
      ]}, handleError(done, function() {
        var currentPage = 0;
        var titles = [];

        var pageCallback = function(page, callback) {
          _.each(page, m => titles.push(m.title));
          return callback();
        };

        var payload = {
          year: 1985,
          _options: {
            pageCallback,
            pages: 'all'
          }
        };

        store.queryMoviesByYear(payload, handleError(done, function() {
          expect(titles.length).to.equal(7);
          return done();
        }));
      }));
    });

    it("should support page reducer", function(done) {
      store.getMoviesCountWithPaging({_options: {raw: true, pages: 'all', pageReduce: (result, page) => result + page.Count, pageReduceInitial: 0}}, handleError(done, function(result) {
        expect(result).to.equal(14);
        return done();
      }));
    });

    it("should support helper paging reducer options", function(done) {
      var params = {something: "hello"};
      store.getMoviesCountWithPaging(dynochamber.makeRecordsCounter(params), handleError(done, function(result) {
        //this expectation is written to verify that we do not modify passed parameters
        expect(params).to.deep.equal({something: "hello"});
        expect(result).to.equal(14);
        return done();
      }));
    });
  });

  describe("validation", function() {
    it("should fail if validator is present and fails", function(done) {
      var descriptionWithValidator = {
        tableName: "Movies",
        operations: {
          addMovie: {
            _type: 'put',
            _validator: m => {
              if(_.isUndefined(m.gross) || _.isNull(m.gross)) return {failed: true, message: 'must have gross field'};
              return null;
            },
            Item: '{{movie}}'
          }
        }
      };

      var store = dynochamber.loadStore(descriptionWithValidator);

      store.addMovie({movie: {year: 2010, title: 'Dark Knight'}}, function(err, results) {
        expect(results).to.not.exist;
        expect(err).to.deep.equal({failed: true, message: 'must have gross field'});
        return done();
      });
    });

    it("should not fail if validator is present, but do not fail", function(done) {
      var descriptionWithValidator = {
        tableName: "Movies",
        operations: {
          addMovie: {
            _type: 'put',
            _validator: m => ({failed: false}),
            Item: '{{movie}}'
          }
        }
      };

      var store = dynochamber.loadStore(descriptionWithValidator);

      store.addMovie({movie: {year: 2010, title: 'Dark Knight'}}, function(err, results) {
        expect(err).to.not.exist;
        return done();
      });
    });

    it("should not fail if validator returns nothing", function(done) {
      var descriptionWithValidator = {
        tableName: "Movies",
        operations: {
          addMovie: {
            _type: 'put',
            _validator: m => null,
            Item: '{{movie}}'
          }
        }
      };

      var store = dynochamber.loadStore(descriptionWithValidator);

      store.addMovie({movie: {year: 2011, title: 'Dark Knight Rises'}}, function(err, results) {
        expect(err).to.not.exist;
        return done();
      });
    });

    it("should apply validation on pure model", function(done) {
      var descriptionWithValidator = {
        tableName: "Movies",
        operations: {
          addMovie: {
            _type: 'put',
            _validator: m => m._options ? {failed: true} : {failed: false},
            Item: '{{movie}}'
          }
        }
      };

      var store = dynochamber.loadStore(descriptionWithValidator);

      store.addMovie({movie: {year: 2011, title: 'Dark Knight Rises'}, _options: {}}, function(err, results) {
        expect(err).to.not.exist;
        return done();
      });
    });
  });

  describe("external dynamoDB", function() {
    it('should fail when dynamodb is reconfigured with a custom dynamodb client', function(done) {
      var dynamodbClient = new aws.DynamoDB({endpoint: new aws.Endpoint("http://localhost:4242")});
      var store = dynochamber.loadStore(storeDescription, dynamodbClient);

      store.getMovie({key: {year: 2013, title: "Superman"}}, handleError(done, function(results) {
        // this operation should never succeed, meaning this line should not be executed
        expect(true).to.be.false;
        return done();
      }));

      global.setTimeout(_ => {return done();}, 1000);
    });
  });
});
